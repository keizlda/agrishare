import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Pencil, Plus, Printer, Trash2, Truck, Users, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import DateInput from "../components/ui/DateInput.jsx";
import FarmerTagInput from "../components/distributions/FarmerTagInput.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import {
  checkDuplicateDistribution,
  createDistribution,
  deleteDistribution,
  listDistributionBeneficiaries,
  listDistributions,
  listEligibleFarmers,
  updateDistribution,
  updateDistributionStatus,
} from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";
import { formatDate, todayIso } from "../lib/dates.js";
import { formatItemsTotal, formatQuantity, isSplitQuantity, isWholeUnit, splitEqually } from "../lib/quantity.js";
import { activeTypes, computeAllocation, defaultType, describeCalculation, formatHectares, formatKg, hasTypes } from "../lib/allocation.js";
import { friendlyError } from "../lib/friendlyError.js";
import { DISTRIBUTION_STATUSES, completedOn } from "../lib/distributionStatus.js";
import { rowLinkProps } from "../lib/rowLink.js";

// New chips added during this edit split whatever's left after
// already-edited/loaded rows' quantities are subtracted from the total —
// existing saved rows (edited: true) keep their stored qty. The split is in
// whole units for sets, heads, bags… and in hundredths otherwise: everyone
// gets the same share rounded down and the remainder goes one unit (or
// 0.01) at a time to the first farmers, so the shares always add up to
// exactly the total (23 sets for 2 farmers → 12 and 11).
function redistributeQuantities(rows, totalQuantity, unit) {
  const unedited = rows.filter((r) => !r.edited);
  if (unedited.length === 0) return rows;
  const editedCents = rows.filter((r) => r.edited).reduce((sum, r) => sum + Math.round((Number(r.quantity) || 0) * 100), 0);
  const remaining = Math.max(Math.round((Number(totalQuantity) || 0) * 100) - editedCents, 0) / 100;
  const shares = splitEqually(remaining, unedited.length, unit);
  let seen = 0;
  return rows.map((r) => (r.edited ? r : { ...r, quantity: shares[seen++] }));
}

// Two statuses: Ongoing -> Completed (items released and beneficiaries
// signed). Completing a distribution records every tagged farmer as
// Acknowledged on that date — see lib/distributionStatus.js.
const STATUS_HELP = "Mark as Completed after the items are released and beneficiaries have signed.";

const EMPTY_FORM = {
  commodityId: "",
  program: "",
  venue: "",
  taggedBeneficiaries: [],
  quantity: "",
  fundingSource: "",
  status: "Ongoing",
};

export default function Distributions() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const { data: distributions, setData: setDistributions, loading, error: loadError } = useSupabaseList(listDistributions);
  const [commodities, setCommodities] = useState([]);
  // ?status= preselects the status filter (the Dashboard's "ongoing" chip).
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(() =>
    DISTRIBUTION_STATUSES.includes(searchParams.get("status")) ? searchParams.get("status") : "All",
  );
  const [programFilter, setProgramFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", distribution }
  const [toast, setToast] = useState(null);
  const [beneficiaryRows, setBeneficiaryRows] = useState([]);
  const [beneficiaryLoading, setBeneficiaryLoading] = useState(false);

  useEffect(() => {
    listCommodities()
      .then((rows) => setCommodities(rows.filter((c) => c.status === "Active")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId && distributions.length > 0) setSelectedId(distributions[0].id);
  }, [distributions, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setBeneficiaryRows([]);
      return undefined;
    }
    let cancelled = false;
    setBeneficiaryLoading(true);
    listDistributionBeneficiaries(selectedId)
      .then((rows) => {
        if (!cancelled) setBeneficiaryRows(rows);
      })
      .catch(() => {
        if (!cancelled) setBeneficiaryRows([]);
      })
      .finally(() => {
        if (!cancelled) setBeneficiaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // De-duplicated case-insensitively — "RCEF Seed Distribution" and "rcef
  // seed distribution" are the same program, and only need one filter option
  // between them (whichever casing was seen first).
  const programOptions = useMemo(() => {
    const seen = new Map();
    for (const d of distributions) {
      const trimmed = (d.program || "").trim();
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.set(trimmed.toLowerCase(), trimmed);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [distributions]);

  const filtered = useMemo(
    () =>
      distributions.filter(
        (d) =>
          (statusFilter === "All" || d.status === statusFilter) &&
          (programFilter === "All" || (d.program || "").trim().toLowerCase() === programFilter.trim().toLowerCase()),
      ),
    [distributions, statusFilter, programFilter],
  );

  // Rows per page = however many fit in the full-height table area (min 5).
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, pageSize);
  useCardLabels(tableRef);
  const detailRef = useRef(null);
  const revealDetail = useRevealDetail(detailRef);

  const selected = distributions.find((d) => d.id === selectedId) ?? null;

  function handleCreated(newDist) {
    setDistributions((prev) => [newDist, ...prev]);
    setSelectedId(newDist.id);
    setModal(null);
    setToast({ tone: "success", message: "Distribution recorded." });
  }

  function handleUpdated(updated) {
    setDistributions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setModal(null);
    setToast({ tone: "success", message: "Distribution updated." });
  }

  function handleDeleted(deletedId) {
    setDistributions((prev) => {
      const next = prev.filter((d) => d.id !== deletedId);
      if (selectedId === deletedId) {
        const stillVisible = filtered.filter((d) => d.id !== deletedId);
        setSelectedId(stillVisible[0]?.id ?? next[0]?.id ?? null);
      }
      return next;
    });
    setToast({ tone: "success", message: "Distribution deleted." });
  }

  return (
    <div className="agri-fill-root">
      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {loadError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError}
            </div>
          )}
          <div className="agri-toolbar">
            {isMAO && (
              <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({ mode: "add" })}>
                <Plus size={16} /> New Distribution
              </button>
            )}

            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "160px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              {DISTRIBUTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "200px" }} value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
              <option value="All">All Programs</option>
              {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead>
                <tr><th>Date</th><th>Crop Type</th><th>Program</th><th>Beneficiaries</th><th>Quantity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((d) => (
                  <tr
                    key={d.id}
                    {...rowLinkProps(() => {
                      setSelectedId(d.id);
                      revealDetail();
                    }, { selected: d.id === selectedId })}
                  >
                    <td>{formatDate(d.date)}</td>
                    <td>{d.cropType}</td>
                    <td className="agri-cell-truncate" title={d.program || undefined}>
                      {d.program ? <span className="agri-row-title">{d.program}</span> : <span className="agri-muted">—</span>}
                    </td>
                    <td>
                      {d.taggedBeneficiaryCount > 0 ? (
                        `${d.taggedBeneficiaryCount} tagged`
                      ) : (
                        <span className="agri-muted">{d.beneficiaries} farmers (not tagged)</span>
                      )}
                    </td>
                    <td>{formatItemsTotal(d.items)}</td>
                    <td><Pill status={d.status} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Loading distributions…</td></tr>
                )}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <EmptyState
                icon={Truck}
                title="No distributions found"
                hint={statusFilter !== "All" || programFilter !== "All" ? "No distributions match these filters. Try a different status or program." : "Record a distribution to see it listed here."}
              />
            )}
          </div>

          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["distribution", "distributions"]} />
        </div>

        {selected && (
          <div ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header" style={{ alignItems: "flex-start" }}>
              <div style={{ fontWeight: 700 }}>Distribution Details</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <Pill status={selected.status} />
                {selected.status === "Completed" && (
                  <div className="agri-muted" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>Completed on {completedOn(selected)}</div>
                )}
              </div>
            </div>
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginBottom: 10 }}>
              {formatDate(selected.date)}
            </div>

            <div className="agri-detail-body">
            <div className="agri-detail-row"><div><div className="agri-detail-label">Program</div>{selected.program}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay</div>{selected.barangay}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Venue</div>{selected.venue}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Funding Source</div>{selected.fundingSource || "—"}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Total Beneficiaries</div>{selected.beneficiaries} Farmers</div></div>
            {selected.allocationKg != null && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay Allocation</div>Allocation used: {formatKg(selected.items[0]?.quantity ?? 0)} of {formatKg(selected.allocationKg)}</div></div>
            )}
            {selected.remarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Remarks</div>{selected.remarks}</div></div>
            )}

            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 16, marginBottom: 8 }}>Beneficiaries</div>
            {beneficiaryLoading ? (
              <div className="agri-muted" style={{ fontSize: "0.78rem" }}>Loading beneficiaries…</div>
            ) : beneficiaryRows.length === 0 ? (
              <div className="agri-muted" style={{ fontSize: "0.78rem" }}>No farmers tagged for this distribution yet.</div>
            ) : (
              <div className="agri-beneficiary-table-wrap">
                <table className="agri-table">
                  <thead><tr><th>Farmer</th><th>Type</th><th className="text-end">Farm Size (ha)</th><th className="text-end">Qty</th></tr></thead>
                  <tbody>
                    {beneficiaryRows.map((row) => (
                      <tr key={row.claimId}>
                        <td>
                          {row.firstName} {row.lastName}
                          {row.farmerDeleted && <span className="agri-muted"> (removed)</span>}
                          {row.adjusted && <span className="agri-tag-adjusted">Adjusted</span>}
                          <span className="agri-beneficiary-sub">RSBSA {row.rsbsaNo}</span>
                          {row.adjusted && row.adjustmentReason && <div className="agri-adjusted-note">Reason: {row.adjustmentReason}</div>}
                        </td>
                        <td>{row.typeName || <span className="agri-muted">—</span>}</td>
                        <td className="text-end">{row.farmSize > 0 ? row.farmSize.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
                        <td className="agri-beneficiary-qty-cell text-end">{formatQuantity(row.quantity, row.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 16, marginBottom: 8 }}>Items Distributed</div>
            <div className="agri-table-wrap">
              <table className="agri-table">
                <thead><tr><th>Item</th><th>Quantity</th><th>Unit</th></tr></thead>
                <tbody>
                  {selected.items.map((item) => (
                    <tr key={item.name}>
                      <td>{item.name}</td>
                      <td>{item.quantity.toLocaleString()}</td>
                      <td>{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            </div>

            {/* Top to bottom: Mark as completed (Ongoing only), Edit | Delete,
                Print. The Farmers' Association President sees only Print. */}
            <div className="agri-detail-actions">
              {isMAO && selected.status === "Ongoing" && (
                <MarkCompletedButton
                  key={selected.id}
                  distribution={selected}
                  onSaved={(updated) => {
                    setDistributions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                    setToast({ tone: "success", message: "Distribution marked as completed." });
                  }}
                  onError={(message) => setToast({ tone: "error", message })}
                />
              )}

              {isMAO && (
                <div className="agri-detail-actions-row">
                  <button
                    type="button"
                    className="btn agri-detail-btn agri-detail-btn-edit d-flex align-items-center justify-content-center gap-2"
                    onClick={() => setModal({ mode: "edit", distribution: selected })}
                  >
                    <Pencil size={16} /> Edit
                  </button>

                  <DeleteDistributionButton distribution={selected} onDeleted={handleDeleted} onError={(message) => setToast({ tone: "error", message })} />
                </div>
              )}

              <button
                type="button"
                className="btn agri-detail-btn agri-detail-btn-print w-100 d-flex align-items-center justify-content-center gap-2"
                onClick={() => window.open(`/print/distributions/${selected.id}`, "_blank", "noopener,noreferrer")}
              >
                <Printer size={16} /> Print Distribution Report
              </button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <DistributionModal
          mode={modal.mode}
          distribution={modal.distribution}
          commodities={commodities}
          onClose={() => setModal(null)}
          onSaved={modal.mode === "edit" ? handleUpdated : handleCreated}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

// "Mark as completed" for an Ongoing distribution (MAO only), after a
// confirmation. Completed distributions show "Completed on [date]" instead.
function MarkCompletedButton({ distribution, onSaved, onError }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleClick() {
    if ((distribution.taggedBeneficiaryCount ?? 0) === 0) {
      onError("Tag at least one beneficiary before marking this distribution as completed.");
      return;
    }
    setConfirming(true);
  }

  async function handleConfirm() {
    setConfirming(false);
    setSaving(true);
    try {
      onSaved(await updateDistributionStatus(distribution.id, "Completed"));
    } catch (err) {
      onError(friendlyError(err, "Failed to update status."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-agri-primary agri-detail-btn w-100 d-flex align-items-center justify-content-center gap-2"
        disabled={saving}
        onClick={handleClick}
      >
        <CheckCircle2 size={16} /> {saving ? "Saving…" : "Mark as completed"}
      </button>

      {confirming && (
        <ConfirmDialog
          title="Mark as completed?"
          message={`${distribution.program} (${formatDate(distribution.date)}): the items have been released and the beneficiaries have signed. Each tagged farmer is recorded as Acknowledged today and notified that they received their items.`}
          confirmLabel="Mark as completed"
          danger={false}
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function DeleteDistributionButton({ distribution, onDeleted, onError }) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setPendingDelete(false);
    setDeleting(true);
    try {
      await deleteDistribution(distribution.id);
      onDeleted(distribution.id);
    } catch (err) {
      onError(friendlyError(err, "Failed to delete distribution."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn agri-detail-btn agri-detail-btn-delete d-flex align-items-center justify-content-center gap-2"
        disabled={deleting}
        onClick={() => setPendingDelete(true)}
      >
        <Trash2 size={16} /> {deleting ? "Deleting…" : "Delete"}
      </button>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this distribution?"
          message="This can't be undone."
          confirmLabel="Delete"
          onConfirm={handleConfirm}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Allocation by hectare. When the commodity has types (each with a kg/ha
// rate), each tagged farmer gets a type — their profile's Program / type if
// it belongs to this commodity, otherwise the commodity's default — and a
// quantity of farm size × that type's rate. The admin may change a quantity:
// the row is then "Adjusted" and needs a short reason (the database checks
// this too). An optional barangay allocation (kg) caps the total. Without
// types, the old equal split is kept.
// ---------------------------------------------------------------------------
const MAX_REASON_LENGTH = 200;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fullName = (row) => `${row.firstName} ${row.lastName}`.trim();
const farmersWord = (n) => (n === 1 ? "farmer" : "farmers");
const isKgUnit = (unit) => String(unit ?? "").trim().toLowerCase() === "kg";
const listNames = (names, max = 4) => (names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", "));

function farmerRow(farmer, extra = {}) {
  return {
    farmerId: farmer.id ?? farmer.farmerId,
    firstName: farmer.firstName,
    lastName: farmer.lastName,
    rsbsaNo: farmer.rsbsaNo,
    barangay: farmer.barangay,
    sitioPurok: farmer.sitioPurok ?? "",
    cropType: farmer.cropType ?? "",
    farmSize: Number(farmer.farmSize) || 0,
    currentFarmSize: Number(farmer.currentFarmSize ?? farmer.farmSize) || 0,
    avatarUrl: farmer.avatarUrl,
    status: farmer.status ?? "Active",
    farmerDeleted: !!farmer.farmerDeleted,
    profileTypeId: farmer.profileTypeId ?? farmer.typeId ?? null,
    typeId: "",
    quantity: 0,
    edited: false,
    adjustmentReason: "",
    saved: null,
    overrideReason: "",
    duplicate: null,
    ...extra,
  };
}

// The type a farmer gets for this commodity: their own if it belongs to it,
// otherwise the default.
function typeIdFor(farmer, commodity) {
  const types = activeTypes(commodity);
  const own = types.find((t) => String(t.id) === String(farmer.profileTypeId ?? farmer.typeId ?? ""));
  return String((own ?? defaultType(commodity))?.id ?? "");
}

// How a row's quantity stands. A saved row whose quantity and type are
// unchanged keeps the farm size and rate it was saved with (rates changed
// later never alter it); anything else uses the current rate.
function quantityState(row, commodity) {
  const unchanged = !!row.saved && round2(row.quantity) === row.saved.quantity && String(row.typeId) === String(row.saved.typeId ?? "");
  const type = (commodity?.allTypes ?? commodity?.types ?? []).find((t) => String(t.id) === String(row.typeId));
  const rate = unchanged ? row.saved.rate : type && !type.removed ? type.rate : null;
  const size = unchanged ? row.farmSize : row.currentFarmSize;
  const computed = rate ? computeAllocation(rate, size) : null;
  if (computed === null) return { state: unchanged ? "saved" : "manual", computed: null, rate: null, size, type };
  const qty = round2(row.quantity);
  if (unchanged && row.saved.adjusted) return { state: "adjusted", computed, rate, size, type };
  if (qty === computed) return { state: "auto", computed, rate, size, type };
  return { state: unchanged ? "saved" : "adjusted", computed, rate, size, type };
}

function DistributionModal({ mode, distribution, commodities, onClose, onSaved }) {
  const editing = mode === "edit";
  const primaryItem = distribution?.items?.[0];

  const [form, setForm] = useState(() =>
    editing
      ? {
          date: distribution.date,
          barangay: distribution.barangay,
          commodityId: primaryItem?.commodityId != null ? String(primaryItem.commodityId) : String(commodities[0]?.id ?? ""),
          program: distribution.program ?? "",
          venue: distribution.venue,
          taggedBeneficiaries: [],
          quantity: String(primaryItem?.quantity ?? ""),
          allocation: distribution.allocationKg != null ? String(distribution.allocationKg) : "",
          fundingSource: distribution.fundingSource ?? "",
          status: distribution.status,
        }
      : { ...EMPTY_FORM, allocation: "", commodityId: String(commodities[0]?.id ?? "") },
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(editing);
  const [beneficiaryLoadError, setBeneficiaryLoadError] = useState("");
  const savingRef = useRef(false);
  const [pendingFarmer, setPendingFarmer] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [addingEligible, setAddingEligible] = useState(false);
  const addingEligibleRef = useRef(false);
  const [eligibleResult, setEligibleResult] = useState(null);
  const [showReasonErrors, setShowReasonErrors] = useState(false);
  // Rates changed since this (Ongoing) distribution was saved: offer to
  // recompute once.
  const [rateNotice, setRateNotice] = useState(null);
  const duplicateRound = useRef(0);
  const checkedProgram = useRef(form.program.trim());

  useEscapeToClose(true, onClose);

  const commodityOptions = useMemo(() => {
    if (!editing || !primaryItem || commodities.some((c) => String(c.id) === String(primaryItem.commodityId))) return commodities;
    return [...commodities, { id: primaryItem.commodityId, name: primaryItem.name, unit: primaryItem.unit, types: [], allTypes: [] }];
  }, [commodities, editing, primaryItem]);
  const findCommodity = (id) => commodityOptions.find((c) => String(c.id) === String(id)) ?? null;
  const commodity = findCommodity(form.commodityId);
  const unit = commodity?.unit ?? primaryItem?.unit ?? "kg";
  const byType = hasTypes(commodity);
  const showAllocation = isKgUnit(unit);
  const rows = form.taggedBeneficiaries;
  const states = new Map(rows.map((r) => [r.farmerId, quantityState(r, commodity)]));

  // Saved farmers load with their saved quantity, type, rate and adjustment.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    listDistributionBeneficiaries(distribution.id)
      .then((list) => {
        if (cancelled) return;
        const forItem = primaryItem ? list.filter((r) => r.commodityId == null || String(r.commodityId) === String(primaryItem.commodityId)) : list;
        const loaded = forItem.map((r) =>
          farmerRow(r, {
            quantity: r.quantity,
            edited: true,
            typeId: r.typeId ? String(r.typeId) : "",
            saved: { quantity: round2(r.quantity), typeId: r.typeId ? String(r.typeId) : "", rate: r.rate, adjusted: r.adjusted },
            adjustmentReason: r.adjustmentReason ?? "",
            overrideReason: r.overrideReason ?? "",
          }),
        );
        setForm((f) => ({ ...f, taggedBeneficiaries: loaded }));
        // "Hybrid's rate changed from 15 to 18 kg/ha. Recompute quantities?"
        if (distribution.status !== "Completed") {
          const c = findCommodity(primaryItem?.commodityId);
          const changed = new Map();
          for (const r of loaded) {
            const type = c?.types.find((t) => String(t.id) === r.typeId);
            if (type && r.saved.rate && type.rate !== r.saved.rate && !r.saved.adjusted) changed.set(type.id, { name: type.name, from: r.saved.rate, to: type.rate });
          }
          if (changed.size) setRateNotice([...changed.values()]);
        }
      })
      .catch((err) => {
        if (!cancelled) setBeneficiaryLoadError(friendlyError(err, "Couldn't load the tagged farmers."));
      })
      .finally(() => {
        if (!cancelled) setLoadingBeneficiaries(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, distribution?.id]);

  function recomputeChangedRates() {
    setForm((f) => ({
      ...f,
      taggedBeneficiaries: f.taggedBeneficiaries.map((r) => {
        const type = commodity?.types.find((t) => String(t.id) === r.typeId);
        if (!type || !r.saved || r.saved.adjusted || type.rate === r.saved.rate) return r;
        return { ...r, quantity: computeAllocation(type.rate, r.currentFarmSize) };
      }),
    }));
    setRateNotice(null);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const hasUnresolvedDuplicate = rows.some((r) => r.duplicate);
  const distributionYear = () => new Date(form.date || new Date()).getFullYear();

  function checkDuplicates(farmers, { commodityId = form.commodityId, program = form.program.trim(), round = duplicateRound.current } = {}) {
    if (!commodityId || !program || farmers.length === 0) return;
    const year = distributionYear();
    for (const farmer of farmers) {
      const farmerId = farmer.id ?? farmer.farmerId;
      checkDuplicateDistribution({ farmerId, commodityId: Number(commodityId), programName: program, year, excludeEventId: editing ? distribution.id : undefined })
        .then((dup) => {
          if (round !== duplicateRound.current) return;
          setForm((f) => ({ ...f, taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, duplicate: dup } : r)) }));
        })
        .catch(() => {});
    }
  }

  function recheckAllDuplicates(next) {
    duplicateRound.current += 1;
    const round = duplicateRound.current;
    setForm((f) => ({ ...f, taggedBeneficiaries: f.taggedBeneficiaries.map((r) => ({ ...r, duplicate: null })) }));
    checkDuplicates(rows, { ...next, round });
  }

  // New rows: typed and computed, or (no types) a share of the total.
  function newRowFor(farmer) {
    if (!byType) return farmerRow(farmer, { duplicate: farmer.duplicate ?? null });
    const typeId = typeIdFor(farmer, commodity);
    const type = commodity.types.find((t) => String(t.id) === typeId);
    return farmerRow(farmer, { typeId, quantity: computeAllocation(type?.rate, farmer.farmSize) ?? 0, duplicate: farmer.duplicate ?? null });
  }
  function withNewRows(f, farmers) {
    const known = new Set(f.taggedBeneficiaries.map((r) => r.farmerId));
    const next = [...f.taggedBeneficiaries, ...farmers.filter((x) => !known.has(x.id)).map(newRowFor)];
    return { ...f, taggedBeneficiaries: byType ? next : redistributeQuantities(next, f.quantity, unit) };
  }

  function addFarmerRow(farmer) {
    setForm((f) => withNewRows(f, [farmer]));
    checkDuplicates([farmer]);
  }

  function handleAddFarmer(farmer) {
    if (farmer.status !== "Active") {
      setPendingFarmer(farmer);
      return;
    }
    addFarmerRow(farmer);
  }

  function handleRemoveFarmer(farmerId) {
    setForm((f) => {
      const next = f.taggedBeneficiaries.filter((r) => r.farmerId !== farmerId);
      return { ...f, taggedBeneficiaries: byType ? next : redistributeQuantities(next, f.quantity, unit) };
    });
  }

  function updateRow(farmerId, patch) {
    setForm((f) => ({ ...f, taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, ...patch } : r)) }));
  }

  // A different type recomputes the quantity straight away.
  function changeRowType(row, typeId) {
    const type = commodity?.types.find((t) => String(t.id) === typeId);
    updateRow(row.farmerId, { typeId, quantity: type ? computeAllocation(type.rate, row.currentFarmSize) : row.quantity });
  }

  function updateTotalQuantity(value) {
    setForm((f) => ({ ...f, quantity: value, taggedBeneficiaries: redistributeQuantities(f.taggedBeneficiaries, value, unit) }));
  }

  // A different commodity: every row gets that commodity's type for the
  // farmer and its quantity is recomputed (an adjusted row keeps the admin's
  // quantity and reason). Moving to a commodity without types keeps the
  // quantities and makes them the total.
  function changeCommodity(id) {
    const next = findCommodity(id);
    setEligibleResult(null);
    setRateNotice(null);
    setForm((f) => {
      if (hasTypes(next)) {
        return {
          ...f,
          commodityId: id,
          taggedBeneficiaries: f.taggedBeneficiaries.map((r) => {
            const typeId = typeIdFor(r, next);
            const type = next.types.find((t) => String(t.id) === typeId);
            const adjusted = quantityState(r, commodity).state === "adjusted";
            return { ...r, typeId, saved: r.saved ? { ...r.saved, typeId: null } : null, quantity: adjusted ? r.quantity : computeAllocation(type?.rate, r.currentFarmSize) ?? r.quantity };
          }),
        };
      }
      const total = round2(f.taggedBeneficiaries.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0));
      return {
        ...f,
        commodityId: id,
        quantity: f.taggedBeneficiaries.length > 0 ? String(total) : f.quantity,
        taggedBeneficiaries: f.taggedBeneficiaries.map((r) => ({ ...r, typeId: "", edited: true })),
      };
    });
    recheckAllDuplicates({ commodityId: id });
  }

  function handleProgramBlur() {
    const program = form.program.trim();
    if (program === checkedProgram.current) return;
    checkedProgram.current = program;
    recheckAllDuplicates({ program });
  }

  const taggedTotal = round2(rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0));
  const totalIsSum = byType && rows.length > 0;
  const allocation = showAllocation && String(form.allocation).trim() !== "" ? Number(form.allocation) : null;
  const allocated = rows.length ? taggedTotal : Number(form.quantity) || 0;
  const overAllocation = allocation !== null && allocation > 0 && allocated > allocation + 0.001;

  // Adds every Active farmer whose crop matches, each with their type and
  // farm size; skips repeat distributions and stops at the allocation.
  async function addAllEligible() {
    if (addingEligibleRef.current || !commodity) return;
    const program = form.program.trim();
    if (!program) {
      setEligibleResult({ tone: "error", text: "Enter the program name first, so farmers who already received this commodity under it are skipped." });
      return;
    }
    addingEligibleRef.current = true;
    setAddingEligible(true);
    setEligibleResult(null);
    try {
      const eligible = await listEligibleFarmers({ commodityId: commodity.id, programName: program, year: distributionYear(), excludeEventId: editing ? distribution.id : undefined });
      const tagged = new Set(rows.map((r) => r.farmerId));
      const already = eligible.filter((f) => tagged.has(f.id));
      const repeats = eligible.filter((f) => !tagged.has(f.id) && f.duplicate);
      const toAdd = [];
      const noRoom = [];
      let running = taggedTotal;
      for (const f of eligible.filter((x) => !tagged.has(x.id) && !x.duplicate)) {
        const row = newRowFor({ ...f, profileTypeId: f.typeId });
        if (byType && allocation !== null && running + Number(row.quantity) > allocation + 0.001) {
          noRoom.push(f);
          continue;
        }
        running += Number(row.quantity) || 0;
        toAdd.push({ ...f, profileTypeId: f.typeId });
      }
      setForm((f) => withNewRows(f, toAdd));
      if (eligible.length === 0) {
        setEligibleResult({ tone: "info", text: `No Active farmers with a ${commodity.category || "matching"} crop were found.` });
      } else {
        const name = (f) => `${f.firstName} ${f.lastName}`;
        const parts = [`Added ${toAdd.length} ${farmersWord(toAdd.length)}.`];
        if (repeats.length) parts.push(`Skipped ${repeats.length} who already received ${commodity.name} under ${program} this year (${listNames(repeats.map(name))}).`);
        if (noRoom.length) parts.push(`Skipped ${noRoom.length} who didn't fit the ${formatKg(allocation)} allocation (${listNames(noRoom.map(name))}).`);
        if (already.length) parts.push(`${already.length} ${already.length === 1 ? "was" : "were"} already tagged.`);
        setEligibleResult({ tone: "info", text: parts.join(" ") });
      }
    } catch (err) {
      setEligibleResult({ tone: "error", text: friendlyError(err, "Couldn't load the eligible farmers. Check your connection and try again.") });
    } finally {
      addingEligibleRef.current = false;
      setAddingEligible(false);
    }
  }

  // Total per type: "Total 1,250 kg · Inbred (RCEF) 1,040 kg · Hybrid 210 kg"
  const perTypeMap = new Map();
  for (const r of rows) {
    const name = states.get(r.farmerId)?.type?.name ?? "No type";
    perTypeMap.set(name, (perTypeMap.get(name) ?? 0) + (Number(r.quantity) || 0));
  }
  const perType = [...perTypeMap.entries()];

  function validate() {
    if (beneficiaryLoadError) return `${beneficiaryLoadError} Close this form and open it again before saving.`;
    if (!form.commodityId) return "Add a commodity in Commodities before recording a distribution.";
    if (!form.program.trim()) return "Program name is required.";
    if (!form.venue.trim()) return "Venue is required.";
    if (editing) {
      const today = todayIso();
      const [y, m, d] = today.split("-");
      if (!form.date) return "Enter the distribution date as MM/DD/YYYY.";
      if (!form.barangay.trim()) return "Barangay is required.";
      if (form.status === "Completed" && form.date > today) return "A completed distribution can't have a future date.";
      if (form.date > `${Number(y) + 1}-${m}-${d}`) return "Enter a date within the next year.";
    }
    if (showAllocation && String(form.allocation).trim() !== "" && !(/^\d+(\.\d{1,2})?$/.test(String(form.allocation).trim()) && Number(form.allocation) > 0)) {
      return "Enter the barangay allocation as kg greater than 0 (up to 2 decimals), or leave it blank.";
    }
    if (hasUnresolvedDuplicate && !overrideReason.trim()) {
      return "One or more tagged farmers already received this commodity under this program this year. Remove them or provide an override reason.";
    }
    if (form.status !== "Ongoing" && rows.length === 0) return `Tag at least one beneficiary before setting the status to ${form.status}.`;
    const total = Number(form.quantity);
    const wholeOnly = `${unit} can't be split`;
    if (rows.length === 0) {
      if (!(total > 0)) return "Enter a total quantity greater than 0.";
      if (isSplitQuantity(total, unit)) return `Enter a whole number for Total Quantity: ${wholeOnly}.`;
    } else {
      const zero = rows.find((r) => !(Number(r.quantity) > 0));
      if (zero) {
        return byType && !(states.get(zero.farmerId)?.size > 0)
          ? `${fullName(zero)} has no farm size on record. Enter their quantity and a reason, or remove them.`
          : "Each farmer's quantity must be greater than 0.";
      }
      const split = rows.find((r) => isSplitQuantity(r.quantity, unit));
      if (split) return `Enter a whole number for ${fullName(split)}: ${wholeOnly}.`;
      if (byType) {
        const noType = rows.find((r) => !r.typeId && !(r.saved && !r.saved.typeId && round2(r.quantity) === r.saved.quantity));
        if (noType) return `Choose a type for ${fullName(noType)}.`;
        const missing = rows.find((r) => states.get(r.farmerId)?.state === "adjusted" && !r.adjustmentReason.trim());
        if (missing) return `Give a short reason for the adjusted quantity of ${fullName(missing)}.`;
        if (rows.some((r) => r.adjustmentReason.trim().length > MAX_REASON_LENGTH)) return `Keep each adjustment reason to ${MAX_REASON_LENGTH} characters or fewer.`;
      } else if (form.quantity !== "" && total > 0 && Math.abs(taggedTotal - total) > 0.005) {
        return `The farmers' quantities add up to ${formatQuantity(taggedTotal, unit)}, but Total Quantity is ${formatQuantity(total, unit)}. Change them so they match.`;
      }
      if (!totalIsSum && form.quantity !== "" && isSplitQuantity(total, unit)) return `Enter a whole number for Total Quantity: ${wholeOnly}.`;
    }
    if (overAllocation) {
      return `The farmers' quantities (${formatKg(allocated)}) are more than the barangay allocation (${formatKg(allocation)}). Raise the allocation or lower the quantities.`;
    }
    return "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (savingRef.current) return;
    const problem = validate();
    setFormError(problem);
    setShowReasonErrors(true);
    if (problem) return;
    const program = form.program.trim();
    savingRef.current = true;
    setSaving(true);
    try {
      const taggedBeneficiaries = rows.map((r) => ({
        farmerId: r.farmerId,
        quantity: round2(r.quantity),
        typeId: r.typeId ? Number(r.typeId) : null,
        overrideReason: r.duplicate ? overrideReason.trim() : r.overrideReason || "",
        adjustmentReason: states.get(r.farmerId)?.state === "adjusted" ? r.adjustmentReason.trim() : "",
      }));
      const quantity = totalIsSum ? taggedTotal : form.quantity;
      const allocationKg = showAllocation && String(form.allocation).trim() !== "" ? Number(form.allocation) : null;
      const saved = editing
        ? await updateDistribution(distribution.id, {
            date: form.date,
            program,
            venue: form.venue,
            barangay: form.barangay,
            commodityId: form.commodityId,
            quantity,
            allocationKg,
            itemId: primaryItem?.itemId ?? null,
            fundingSource: form.fundingSource,
            status: form.status !== distribution.status ? form.status : undefined,
            taggedBeneficiaries,
          })
        : await createDistribution({
            program,
            venue: form.venue,
            beneficiaries: String(taggedBeneficiaries.length),
            commodityId: form.commodityId,
            quantity,
            allocationKg,
            fundingSource: form.fundingSource,
            status: form.status,
            taggedBeneficiaries,
          });
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this distribution. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const pct = allocation ? Math.min(100, (allocated / allocation) * 100) : 0;
  const barTone = overAllocation ? "red" : allocation && allocated / allocation > 0.9 ? "amber" : "green";

  return (
    <div className="agri-modal-backdrop" onClick={onClose}>
      <form
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "680px" }}
        role="dialog"
        aria-label={editing ? "Edit Distribution" : "New Distribution"}
        onSubmit={handleSubmit}
        noValidate
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">{editing ? "Edit Distribution" : "New Distribution"}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {formError && (
            <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{formError}</div>
          )}

          <div className="agri-detail-section-title" style={{ marginTop: 0 }}>Distribution</div>
          {editing && (
            <div className="row g-3 mb-3">
              <div className="col-12 col-sm-6">
                <label className="agri-form-label">Date</label>
                <DateInput required value={form.date} onChange={(v) => update("date", v)} aria-label="Distribution date" />
              </div>
              <div className="col-12 col-sm-6">
                <label className="agri-form-label">Barangay</label>
                <input required className="form-control" value={form.barangay} onChange={(e) => update("barangay", e.target.value)} />
              </div>
            </div>
          )}
          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="distribution-commodity">Commodity</label>
              <select id="distribution-commodity" className="form-select" value={form.commodityId} onChange={(e) => changeCommodity(e.target.value)} disabled={saving}>
                {commodityOptions.length === 0 && <option value="">No active commodities</option>}
                {commodityOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {byType && <div className="agri-field-hint">{activeTypes(commodity).map((t) => `${t.name} ${t.rate.toLocaleString()} kg/ha`).join(" · ")}</div>}
            </div>
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="distribution-status">Status</label>
              <select id="distribution-status" className="form-select" value={form.status} onChange={(e) => update("status", e.target.value)}>
                {DISTRIBUTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <div className="agri-field-hint">{STATUS_HELP}</div>
            </div>
          </div>
          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="distribution-program">Program Name <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <input id="distribution-program" required className="form-control" maxLength={120} placeholder="e.g. RCEF Seed Distribution" value={form.program} onChange={(e) => update("program", e.target.value)} onBlur={handleProgramBlur} />
            </div>
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="distribution-venue">Venue <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <input id="distribution-venue" required className="form-control" maxLength={120} value={form.venue} onChange={(e) => update("venue", e.target.value)} placeholder="e.g. Barangay Hall" />
            </div>
          </div>

          <div className="agri-detail-section-title">Quantity</div>
          <div className="row g-3 mb-2">
            {showAllocation && (
              <div className="col-12 col-sm-6">
                <label className="agri-form-label" htmlFor="distribution-allocation">Total allocation for the barangay (kg)</label>
                <input id="distribution-allocation" inputMode="decimal" className="form-control" placeholder="e.g. 2000" value={form.allocation} onChange={(e) => update("allocation", e.target.value)} disabled={saving} />
                <div className="agri-field-hint">Optional. Saving is blocked if the farmers' total goes over it.</div>
              </div>
            )}
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="distribution-total">Total Quantity ({unit})</label>
              {totalIsSum ? (
                <>
                  <input id="distribution-total" className="form-control text-end" readOnly value={formatQuantity(taggedTotal, unit)} />
                  <div className="agri-field-hint">The sum of the farmers' quantities below.</div>
                </>
              ) : (
                <>
                  <input id="distribution-total" required type="number" min="0" step={isWholeUnit(unit) ? "1" : "any"} className="form-control" value={form.quantity} onChange={(e) => updateTotalQuantity(e.target.value)} />
                  <div className="agri-field-hint">
                    {byType ? "Tag farmers below and each one's quantity is computed from their farm size and type." : commodity ? "Split equally among the tagged farmers. Add types and kg-per-hectare rates in Commodities to compute this automatically." : ""}
                  </div>
                </>
              )}
            </div>
          </div>

          {allocation !== null && allocation > 0 && (
            <div className={`agri-alloc ${barTone}`} role="status">
              <div className="agri-alloc-text">
                Allocated {formatKg(allocated)} / {formatKg(allocation)} ·{" "}
                {overAllocation ? <strong>Over by {formatKg(allocated - allocation)}</strong> : <>Remaining {formatKg(allocation - allocated)}</>}
              </div>
              <div className="agri-alloc-track"><div className="agri-alloc-fill" style={{ width: `${pct}%` }} /></div>
            </div>
          )}

          {rateNotice && (
            <div className="agri-warning-box" role="status" style={{ alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                {rateNotice.map((n) => `${n.name}'s rate changed from ${n.from.toLocaleString()} to ${n.to.toLocaleString()} kg/ha.`).join(" ")} Recompute quantities?
              </div>
              <button type="button" className="btn btn-sm btn-agri-primary" onClick={recomputeChangedRates}>Recompute</button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setRateNotice(null)}>Keep current</button>
            </div>
          )}

          <div className="agri-detail-section-title">Beneficiaries <span style={{ color: "var(--agri-red)" }}>*</span></div>
          {loadingBeneficiaries ? (
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginBottom: 10 }}>Loading tagged farmers…</div>
          ) : beneficiaryLoadError ? (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{beneficiaryLoadError}</div>
          ) : (
            <>
              <FarmerTagInput taggedFarmers={rows.map((r) => ({ ...r, duplicateWarning: !!r.duplicate }))} onAddFarmer={handleAddFarmer} onRemoveFarmer={handleRemoveFarmer} disabled={saving} />
              <div className="agri-add-eligible-row">
                <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-2" onClick={addAllEligible} disabled={saving || addingEligible || !commodity}>
                  {addingEligible ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" /> : <Users size={14} />}
                  {addingEligible ? "Adding…" : "Add all eligible farmers"}
                </button>
                {eligibleResult ? (
                  <span className="agri-add-eligible-result" role="status" style={eligibleResult.tone === "error" ? { color: "var(--agri-red)" } : undefined}>{eligibleResult.text}</span>
                ) : (
                  <span className="agri-add-eligible-result">Active farmers whose crop is {commodity?.category || "the commodity's category"}.</span>
                )}
              </div>
            </>
          )}

          {rows.length > 0 && (
            <>
              <div className="agri-beneficiary-table-wrap agri-beneficiary-table-wrap-form">
                <table className="agri-table">
                  <thead>
                    <tr><th>Farmer</th>{byType && <th>Type</th>}<th className="agri-col-farm text-end">Farm Size</th><th className="text-end">Qty ({unit})</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const { state, computed, rate, size } = states.get(row.farmerId) ?? { state: "manual" };
                      const reasonMissing = showReasonErrors && state === "adjusted" && !row.adjustmentReason.trim();
                      const removedType = row.typeId && !activeTypes(commodity).some((t) => String(t.id) === row.typeId);
                      return (
                        <Fragment key={row.farmerId}>
                          <tr className={state === "adjusted" ? "agri-beneficiary-adjusted" : undefined}>
                            <td>
                              <div className="agri-beneficiary-name">
                                <span style={{ fontWeight: 600 }}>{fullName(row)}</span>
                                {row.farmerDeleted && <span className="agri-muted"> (removed)</span>}
                                <Pill status={row.status} />
                              </div>
                              <div className="agri-beneficiary-meta">
                                RSBSA {row.rsbsaNo}
                                <br />
                                {[row.sitioPurok, row.barangay].filter(Boolean).join(", ")}
                              </div>
                              <div className="agri-beneficiary-meta agri-beneficiary-farm-inline">{formatHectares(size ?? row.currentFarmSize)}</div>
                              {row.duplicate && (
                                <div className="agri-beneficiary-duplicate-warning">
                                  Already received {formatQuantity(row.duplicate.quantity, unit)} from {row.duplicate.program} on {formatDate(row.duplicate.date)}
                                </div>
                              )}
                            </td>
                            {byType && (
                              <td>
                                <select className="form-select form-select-sm agri-row-type" aria-label={`Type for ${fullName(row)}`} value={row.typeId} onChange={(e) => changeRowType(row, e.target.value)} disabled={saving}>
                                  {!row.typeId && <option value="">Not set</option>}
                                  {removedType && <option value={row.typeId}>{(commodity?.allTypes ?? []).find((t) => String(t.id) === row.typeId)?.name ?? "Type"} (removed)</option>}
                                  {activeTypes(commodity).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                              </td>
                            )}
                            <td className="agri-col-farm text-end">{formatHectares(size ?? row.currentFarmSize)}</td>
                            <td className="agri-beneficiary-qty-cell text-end">
                              <input
                                type="number"
                                min="0"
                                step={isWholeUnit(unit) ? "1" : "0.01"}
                                className="agri-beneficiary-qty-input text-end"
                                aria-label={`Quantity for ${fullName(row)} (${unit})`}
                                value={row.quantity}
                                onChange={(e) => updateRow(row.farmerId, { quantity: e.target.value, edited: true })}
                                disabled={saving}
                              />
                              {state === "adjusted" && <span className="agri-tag-adjusted">Adjusted</span>}
                              {rate ? (
                                <span className="agri-beneficiary-sub">
                                  {describeCalculation(size, rate)}
                                  {state === "adjusted" && computed !== null ? ` = ${formatKg(computed)}` : ""}
                                </span>
                              ) : state === "saved" ? (
                                <span className="agri-beneficiary-sub">as saved before</span>
                              ) : null}
                            </td>
                          </tr>
                          {state === "adjusted" && (
                            <tr className="agri-beneficiary-reason-row">
                              <td colSpan={byType ? 4 : 3}>
                                <input
                                  className={`agri-beneficiary-reason-input${reasonMissing ? " is-invalid" : ""}`}
                                  aria-label={`Reason for adjusting ${fullName(row)}'s quantity`}
                                  maxLength={MAX_REASON_LENGTH}
                                  placeholder={computed > 0 ? `Reason for changing from ${formatKg(computed)} (required)` : "No farm size on record: reason for this quantity (required)"}
                                  value={row.adjustmentReason}
                                  onChange={(e) => updateRow(row.farmerId, { adjustmentReason: e.target.value })}
                                  disabled={saving}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="agri-type-totals">
                {rows.length} {farmersWord(rows.length)} · <strong>Total {formatQuantity(taggedTotal, unit)}</strong>
                {byType && perType.map(([name, kg]) => <span key={name}> · {name} {formatQuantity(round2(kg), unit)}</span>)}
              </div>
            </>
          )}

          {hasUnresolvedDuplicate && (
            <div style={{ margin: "10px 0 14px" }}>
              <label className="agri-form-label">Reason for allowing repeat distribution <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <textarea required className="form-control" rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Explain why these farmers are being tagged again this year" />
            </div>
          )}

          {pendingFarmer && (
            <ConfirmDialog
              title={`Add ${pendingFarmer.firstName} ${pendingFarmer.lastName}?`}
              message="This farmer is inactive. Add them to this distribution anyway?"
              confirmLabel="Add anyway"
              onConfirm={() => {
                const farmer = pendingFarmer;
                setPendingFarmer(null);
                addFarmerRow(farmer);
              }}
              onCancel={() => setPendingFarmer(null)}
            />
          )}

          <div className="agri-detail-section-title">Other details</div>
          <label className="agri-form-label" htmlFor="distribution-funding">Funding Source</label>
          <input id="distribution-funding" className="form-control" placeholder="e.g. DA Regional Field Office IX" value={form.fundingSource} onChange={(e) => update("fundingSource", e.target.value)} />
        </div>

        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Save Distribution"}</button>
        </div>
      </form>
    </div>
  );
}

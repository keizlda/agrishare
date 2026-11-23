import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ChevronDown, Pencil, Plus, Printer, Trash2, Truck, Users, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import DateInput from "../components/ui/DateInput.jsx";
import FarmerTagInput from "../components/distributions/FarmerTagInput.jsx";
import CommodityPicker from "../components/commodities/CommodityPicker.jsx";
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
import { computeAllocation, describeCalculation, formatHectares, formatKg, formatRate } from "../lib/allocation.js";
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
// signed). A new distribution always starts Ongoing; the MAO Admin marks it
// Completed from the status badge in the details (or in Edit). Completing a
// distribution records every tagged farmer as Acknowledged on that date —
// see lib/distributionStatus.js.
const STATUS_HELP = "Completed once the items are released and beneficiaries have signed. Setting it back to Ongoing clears the completion date.";

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
                <StatusBadge
                  key={selected.id}
                  distribution={selected}
                  canChange={isMAO}
                  onSaved={(updated) => {
                    setDistributions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                    setToast({ tone: "success", message: "Distribution marked as completed. The farmers were notified." });
                  }}
                  onError={(message) => setToast({ tone: "error", message })}
                />
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
                  <thead><tr><th>Farmer</th><th className="text-end">Farm Size (ha)</th><th className="text-end">Rate</th><th className="text-end">Qty</th></tr></thead>
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
                        <td className="text-end">{row.farmSize > 0 ? row.farmSize.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
                        <td className="text-end">{formatRate(row.rate)}</td>
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

            {/* Edit | Delete side by side, then Print. The Farmers'
                Association President sees only Print. */}
            <div className="agri-detail-actions">
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
          onCommoditiesChange={setCommodities}
          onClose={() => setModal(null)}
          onSaved={modal.mode === "edit" ? handleUpdated : handleCreated}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

// The status badge in the details. For the MAO Admin an Ongoing badge opens
// a small menu ("Ongoing ▾" → Mark as Completed, after a confirmation); the
// Farmers' Association President sees a plain badge. The database keeps the
// rules (a tagged farmer is required, the completion date is saved, each
// farmer is notified once and recorded as Acknowledged).
function StatusBadge({ distribution, canChange, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const interactive = canChange && distribution.status === "Ongoing";

  useEscapeToClose(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  if (!interactive) return <Pill status={distribution.status} />;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 190) });
    setOpen(true);
  }

  function choose() {
    setOpen(false);
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
      onError(friendlyError(err, "Couldn't mark this distribution as completed. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="agri-pill orange agri-status-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${distribution.status}. Change status`}
        onClick={toggle}
        disabled={saving}
      >
        {saving ? "Saving…" : distribution.status}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && pos &&
        createPortal(
          <div ref={menuRef} className="agri-row-menu" role="menu" style={{ top: pos.top, left: pos.left, width: 190 }}>
            <button type="button" role="menuitem" className="agri-row-menu-item" onClick={choose}>
              <CheckCircle2 size={14} /> Mark as Completed
            </button>
          </div>,
          document.body,
        )}
      {confirming && (
        <ConfirmDialog
          title="Mark this distribution as completed?"
          message="Tagged farmers will be recorded as having received their items and will be notified."
          confirmLabel="Mark as Completed"
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
// Allocation by hectare. When the commodity has a kg/ha rate, each tagged
// farmer gets farm size × that rate. The admin may change a quantity: the
// row is then "Adjusted" and needs a short reason (the database checks this
// too). An optional barangay allocation (kg) caps the total. Without a
// rate, the old equal split is kept.
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
    seedProgramId: farmer.seedProgramId ?? null,
    seedProgram: farmer.seedProgram ?? "",
    quantity: 0,
    recompute: false,
    edited: false,
    adjustmentReason: "",
    saved: null,
    overrideReason: "",
    duplicate: null,
    ...extra,
  };
}

// The commodity's kg/ha rate, when quantities are computed from farm size.
const rateOf = (commodity) => (commodity && isKgUnit(commodity.unit) && commodity.rate > 0 ? commodity.rate : null);

// How a row's quantity stands. A saved row whose quantity is unchanged keeps
// the farm size and rate it was saved with (a later change to the
// commodity's rate never alters it, unless the admin recomputes); anything
// else uses `rateNow` — the commodity's current rate, or a rate chosen for
// this distribution only.
function quantityState(row, rateNow) {
  const unchanged = !!row.saved && !row.recompute && round2(row.quantity) === row.saved.quantity;
  const rate = unchanged ? row.saved.rate : rateNow;
  const size = unchanged ? row.farmSize : row.currentFarmSize;
  const computed = rate ? computeAllocation(rate, size) : null;
  if (computed === null) return { state: unchanged ? "saved" : "manual", computed: null, rate: null, size };
  const qty = round2(row.quantity);
  if (unchanged && row.saved.adjusted) return { state: "adjusted", computed, rate, size };
  if (qty === computed) return { state: "auto", computed, rate, size };
  return { state: unchanged ? "saved" : "adjusted", computed, rate, size };
}

function DistributionModal({ mode, distribution, commodities, onCommoditiesChange, onClose, onSaved }) {
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
  // The commodity's rate changed since this (Ongoing) distribution was
  // saved: offer to recompute once.
  const [rateNotice, setRateNotice] = useState(null);
  // A rate chosen for this distribution only ("Edit rate" → No); the
  // commodity keeps its own.
  const [rateOverride, setRateOverride] = useState(null);
  // Edit: setting a Completed distribution back to Ongoing asks first.
  const [confirmReopen, setConfirmReopen] = useState(false);
  const duplicateRound = useRef(0);
  const checkedProgram = useRef(form.program.trim());

  useEscapeToClose(true, onClose);

  const commodityOptions = useMemo(() => {
    if (!editing || !primaryItem || commodities.some((c) => String(c.id) === String(primaryItem.commodityId))) return commodities;
    return [...commodities, { id: primaryItem.commodityId, name: primaryItem.name, unit: primaryItem.unit, rate: null }];
  }, [commodities, editing, primaryItem]);
  const findCommodity = (id) => commodityOptions.find((c) => String(c.id) === String(id)) ?? null;
  const commodity = findCommodity(form.commodityId);
  const unit = commodity?.unit ?? primaryItem?.unit ?? "kg";
  const commodityRate = rateOverride ?? rateOf(commodity);
  const byRate = commodityRate !== null;
  const showAllocation = isKgUnit(unit);
  const rows = form.taggedBeneficiaries;
  const states = new Map(rows.map((r) => [r.farmerId, quantityState(r, commodityRate)]));

  // Saved farmers load with their saved quantity, rate and adjustment.
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
            saved: { quantity: round2(r.quantity), rate: r.rate, adjusted: r.adjusted },
            adjustmentReason: r.adjustmentReason ?? "",
            overrideReason: r.overrideReason ?? "",
          }),
        );
        setForm((f) => ({ ...f, taggedBeneficiaries: loaded }));
        // "Rice Seeds – Hybrid's allocation changed from 15 to 18 kg/ha
        // since these quantities were saved. Recompute quantities?"
        if (distribution.status !== "Completed") {
          const c = findCommodity(primaryItem?.commodityId);
          const now = rateOf(c);
          const from = [...new Set(loaded.filter((r) => r.saved.rate && !r.saved.adjusted && r.saved.rate !== now).map((r) => r.saved.rate))];
          if (now && from.length) setRateNotice({ name: c.name, from, to: now });
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
        if (!commodityRate || !r.saved || r.saved.adjusted || r.saved.rate === commodityRate) return r;
        return { ...r, recompute: true, quantity: computeAllocation(commodityRate, r.currentFarmSize) };
      }),
    }));
    setRateNotice(null);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // A new rate for this distribution (the commodity's, after "Edit rate" →
  // Yes, or one for this distribution only): every row that isn't an
  // adjusted quantity is computed again with it.
  function applyRate(newRate) {
    setRateNotice(null);
    setForm((f) => ({
      ...f,
      taggedBeneficiaries: f.taggedBeneficiaries.map((r) => {
        if (quantityState(r, commodityRate).state === "adjusted") return r;
        const q = computeAllocation(newRate, r.currentFarmSize);
        return q === null ? r : { ...r, recompute: !!r.saved || r.recompute, quantity: q };
      }),
    }));
  }

  // Commodity picker: a commodity added, edited (rename / rate) or deleted.
  function commodityAdded(c) {
    onCommoditiesChange((prev) => [c, ...prev]);
    changeCommodity(String(c.id), c);
  }
  function commodityUpdated(c) {
    onCommoditiesChange((prev) => prev.map((x) => (x.id === c.id ? c : x)));
    if (String(c.id) === String(form.commodityId)) {
      const next = rateOf(c);
      setRateOverride(null);
      if (next !== null && next !== commodityRate) applyRate(next);
    }
  }
  function commodityDeleted(id) {
    onCommoditiesChange((prev) => prev.filter((x) => x.id !== id));
    if (String(id) === String(form.commodityId) && !(editing && String(primaryItem?.commodityId) === String(id))) {
      setForm((f) => ({ ...f, commodityId: "" }));
      setRateOverride(null);
    }
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

  // New rows: farm size × the commodity's rate, or (no rate) a share of the total.
  function newRowFor(farmer) {
    if (!byRate) return farmerRow(farmer, { duplicate: farmer.duplicate ?? null });
    return farmerRow(farmer, { quantity: computeAllocation(commodityRate, farmer.farmSize) ?? 0, duplicate: farmer.duplicate ?? null });
  }
  function withNewRows(f, farmers) {
    const known = new Set(f.taggedBeneficiaries.map((r) => r.farmerId));
    const next = [...f.taggedBeneficiaries, ...farmers.filter((x) => !known.has(x.id)).map(newRowFor)];
    return { ...f, taggedBeneficiaries: byRate ? next : redistributeQuantities(next, f.quantity, unit) };
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
      return { ...f, taggedBeneficiaries: byRate ? next : redistributeQuantities(next, f.quantity, unit) };
    });
  }

  function updateRow(farmerId, patch) {
    setForm((f) => ({ ...f, taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, ...patch } : r)) }));
  }

  function updateTotalQuantity(value) {
    setForm((f) => ({ ...f, quantity: value, taggedBeneficiaries: redistributeQuantities(f.taggedBeneficiaries, value, unit) }));
  }

  // A different commodity: every row's quantity is recomputed with that
  // commodity's rate (an adjusted row keeps the admin's quantity and
  // reason). Moving to a commodity without a rate keeps the quantities and
  // makes them the total.
  function changeCommodity(id, nextCommodity = findCommodity(id)) {
    const next = nextCommodity;
    const nextRate = rateOf(next);
    setEligibleResult(null);
    setRateNotice(null);
    setRateOverride(null);
    setForm((f) => {
      if (nextRate) {
        return {
          ...f,
          commodityId: id,
          taggedBeneficiaries: f.taggedBeneficiaries.map((r) => {
            const adjusted = quantityState(r, commodityRate).state === "adjusted";
            return { ...r, saved: null, quantity: adjusted ? r.quantity : computeAllocation(nextRate, r.currentFarmSize) ?? r.quantity };
          }),
        };
      }
      const total = round2(f.taggedBeneficiaries.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0));
      return {
        ...f,
        commodityId: id,
        quantity: f.taggedBeneficiaries.length > 0 ? String(total) : f.quantity,
        taggedBeneficiaries: f.taggedBeneficiaries.map((r) => ({ ...r, saved: null, edited: true })),
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
  const totalIsSum = byRate && rows.length > 0;
  const allocation = showAllocation && String(form.allocation).trim() !== "" ? Number(form.allocation) : null;
  const allocated = rows.length ? taggedTotal : Number(form.quantity) || 0;
  const overAllocation = allocation !== null && allocation > 0 && allocated > allocation + 0.001;

  // Adds every Active farmer enrolled in this commodity (or, when nobody
  // is, whose crop matches its category), each at farm size × rate; skips
  // repeat distributions and stops at the allocation.
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
        const row = newRowFor(f);
        if (byRate && allocation !== null && running + Number(row.quantity) > allocation + 0.001) {
          noRoom.push(f);
          continue;
        }
        running += Number(row.quantity) || 0;
        toAdd.push(f);
      }
      setForm((f) => withNewRows(f, toAdd));
      if (eligible.length === 0) {
        setEligibleResult({ tone: "info", text: `No Active farmers enrolled in ${commodity.name} or with a ${commodity.category || "matching"} crop were found.` });
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

  // A tagged farmer enrolled in a different seed program gets a warning chip.
  const enrolledElsewhere = (row) => {
    if (!row.seedProgramId || !commodity || String(row.seedProgramId) === String(commodity.id)) return "";
    return row.seedProgram || findCommodity(row.seedProgramId)?.name || "another seed program";
  };

  function validate() {
    if (beneficiaryLoadError) return `${beneficiaryLoadError} Close this form and open it again before saving.`;
    if (!form.commodityId) return "Choose a commodity (or add one with “+ Add new commodity”).";
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
        return byRate && !(states.get(zero.farmerId)?.size > 0)
          ? `${fullName(zero)} has no farm size on record. Enter their quantity and a reason, or remove them.`
          : "Each farmer's quantity must be greater than 0.";
      }
      const split = rows.find((r) => isSplitQuantity(r.quantity, unit));
      if (split) return `Enter a whole number for ${fullName(split)}: ${wholeOnly}.`;
      if (byRate) {
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
    if (editing && distribution.status === "Completed" && form.status === "Ongoing") {
      setConfirmReopen(true);
      return;
    }
    await doSave();
  }

  async function doSave() {
    setConfirmReopen(false);
    const program = form.program.trim();
    savingRef.current = true;
    setSaving(true);
    try {
      // Rows moved to another commodity are computed again with its rate.
      const commodityChanged = editing && !!primaryItem && String(form.commodityId) !== String(primaryItem.commodityId);
      const taggedBeneficiaries = rows.map((r) => ({
        farmerId: r.farmerId,
        quantity: round2(r.quantity),
        recompute: r.recompute || commodityChanged,
        ...(rateOverride != null ? { rate: rateOverride } : {}),
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
            status: "Ongoing",
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
            <div className={editing ? "col-12 col-sm-7" : "col-12"}>
              <label className="agri-form-label" htmlFor="distribution-commodity">Commodity</label>
              <CommodityPicker
                id="distribution-commodity"
                commodities={commodityOptions}
                allCommodities={commodities}
                value={form.commodityId}
                onChange={(id) => changeCommodity(id)}
                rate={commodityRate}
                overridden={rateOverride != null}
                canManage
                disabled={saving}
                onAdded={commodityAdded}
                onUpdated={commodityUpdated}
                onDeleted={commodityDeleted}
                onRateForThis={(r) => {
                  setRateOverride(r);
                  applyRate(r);
                }}
              />
            </div>
            {editing && (
              <div className="col-12 col-sm-5">
                <label className="agri-form-label" htmlFor="distribution-status">Status</label>
                <select id="distribution-status" className="form-select" value={form.status} onChange={(e) => update("status", e.target.value)}>
                  {DISTRIBUTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <div className="agri-field-hint">{STATUS_HELP}</div>
              </div>
            )}
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
                    {byRate
                      ? "Tag farmers below and each one's quantity is computed from their farm size."
                      : commodity
                        ? `Split equally among the tagged farmers.${isKgUnit(unit) ? " Set the commodity's allocation per hectare (“Set rate” above) to compute it from farm size." : ""}`
                        : ""}
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
                {`${rateNotice.name}'s allocation changed from ${rateNotice.from.map((r) => r.toLocaleString()).join(" / ")} to ${formatRate(rateNotice.to)} since these quantities were saved. Recompute quantities?`}
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
                  <span className="agri-add-eligible-result">
                    {commodity ? `Active farmers enrolled in ${commodity.name} (or, if none are, whose crop is ${commodity.category || "its category"}).` : "Choose a commodity first."}
                  </span>
                )}
              </div>
            </>
          )}

          {rows.length > 0 && (
            <>
              <div className="agri-beneficiary-table-wrap agri-beneficiary-table-wrap-form">
                <table className="agri-table">
                  <thead>
                    <tr><th>Farmer</th><th className="agri-col-farm text-end">Farm Size</th><th className="text-end">Qty ({unit})</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const { state, computed, rate, size } = states.get(row.farmerId) ?? { state: "manual" };
                      const reasonMissing = showReasonErrors && state === "adjusted" && !row.adjustmentReason.trim();
                      const elsewhere = enrolledElsewhere(row);
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
                              {elsewhere && <span className="agri-enrolled-chip" title="This farmer's Seed program is a different commodity">Enrolled in {elsewhere}</span>}
                              {row.duplicate && (
                                <div className="agri-beneficiary-duplicate-warning">
                                  Already received {formatQuantity(row.duplicate.quantity, unit)} from {row.duplicate.program} on {formatDate(row.duplicate.date)}
                                </div>
                              )}
                            </td>
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
                              <td colSpan={3}>
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
              </div>
            </>
          )}

          {hasUnresolvedDuplicate && (
            <div style={{ margin: "10px 0 14px" }}>
              <label className="agri-form-label">Reason for allowing repeat distribution <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <textarea required className="form-control" rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Explain why these farmers are being tagged again this year" />
            </div>
          )}

          {confirmReopen && (
            <ConfirmDialog
              title="Set this distribution back to Ongoing?"
              message="Use this if it was marked Completed by mistake. The completion date is cleared; farmers who were already notified aren't notified again."
              confirmLabel="Set to Ongoing"
              danger={false}
              onConfirm={doSave}
              onCancel={() => setConfirmReopen(false)}
            />
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

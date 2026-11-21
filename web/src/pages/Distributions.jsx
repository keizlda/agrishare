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
import { formatItemsTotal, formatQuantity } from "../lib/quantity.js";
import { computeAllocation, describeAllocation, formatBags, formatHectares, formatWithBags, hasAllocation } from "../lib/allocation.js";
import { friendlyError } from "../lib/friendlyError.js";
import { DISTRIBUTION_STATUSES, completedOn } from "../lib/distributionStatus.js";
import { rowLinkProps } from "../lib/rowLink.js";

// New chips added during this edit split whatever's left after
// already-edited/loaded rows' quantities are subtracted from the total —
// existing saved rows (edited: true) keep their stored qty. Works in
// integer cents throughout so the shares always add back up to exactly the
// total: each share is rounded DOWN to 2 decimals, and every last cent of
// leftover from that rounding goes to the last unedited farmer, rather than
// letting each row round independently and the total drift off by a cent.
function redistributeQuantities(rows, totalQuantity) {
  const unedited = rows.filter((r) => !r.edited);
  if (unedited.length === 0) return rows;
  const editedCents = rows.filter((r) => r.edited).reduce((sum, r) => sum + Math.round((Number(r.quantity) || 0) * 100), 0);
  const remainingCents = Math.max(Math.round((Number(totalQuantity) || 0) * 100) - editedCents, 0);
  const shareCents = Math.floor(remainingCents / unedited.length);
  const leftoverCents = remainingCents - shareCents * unedited.length;
  let seen = 0;
  return rows.map((r) => {
    if (r.edited) return r;
    seen += 1;
    const cents = seen === unedited.length ? shareCents + leftoverCents : shareCents;
    return { ...r, quantity: cents / 100 };
  });
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
                  <thead><tr><th>Farmer</th><th>RSBSA No.</th><th>Farm Size (ha)</th><th>Qty</th></tr></thead>
                  <tbody>
                    {beneficiaryRows.map((row) => (
                      <tr key={row.claimId}>
                        <td>
                          {row.firstName} {row.lastName}
                          {row.farmerDeleted && <span className="agri-muted"> (removed)</span>}
                          {row.adjusted && <span className="agri-tag-adjusted">Adjusted</span>}
                          {row.adjusted && row.adjustmentReason && <div className="agri-adjusted-note">Reason: {row.adjustmentReason}</div>}
                        </td>
                        <td>{row.rsbsaNo}</td>
                        <td>{row.farmSize > 0 ? row.farmSize.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                        <td className="agri-beneficiary-qty-cell">
                          {formatQuantity(row.quantity, row.unit)}
                          {formatBags(row.quantity, row.packSize) && <span className="agri-beneficiary-sub">{formatBags(row.quantity, row.packSize)}</span>}
                        </td>
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
                      <td>
                        {item.quantity.toLocaleString()}
                        {formatBags(item.quantity, item.packSize) && <span className="agri-beneficiary-sub">{formatBags(item.quantity, item.packSize)}</span>}
                      </td>
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
                onClick={() => window.open(`/print/distributions/${selected.id}?autoPrint=1`, "_blank", "noopener,noreferrer")}
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
// Quantities by farm size. When the commodity has an allocation per hectare,
// each tagged farmer's quantity is computed (farm size × rate, capped, 2
// decimals) and the total is their sum. The admin may change a farmer's
// quantity: the row is then "Adjusted" and needs a short reason (the
// database checks this too). Without a rate, the old equal split is kept.
// ---------------------------------------------------------------------------
const MAX_REASON_LENGTH = 200;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A tagged-farmer row of the form.
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
    quantity: 0,
    edited: false,
    adjustmentReason: "",
    savedQuantity: null,
    savedAdjusted: false,
    overrideReason: "",
    duplicate: null,
    ...extra,
  };
}

// The farm size a row's quantity is computed from: the size saved with it
// while its quantity is unchanged, otherwise the farmer's current size (the
// database does the same).
function sizeFor(row) {
  const unchanged = row.savedQuantity !== null && round2(row.quantity) === row.savedQuantity;
  return unchanged ? row.farmSize : row.currentFarmSize;
}

// state: "auto" (= farm size × rate), "adjusted" (changed — needs a reason),
// "saved" (saved before quantities followed farm size; kept as it was), or
// "manual" (the commodity has no allocation per hectare).
function quantityState(row, commodity) {
  const computed = computeAllocation(commodity, sizeFor(row));
  if (computed === null) return { state: "manual", computed };
  const qty = round2(row.quantity);
  const unchanged = row.savedQuantity !== null && qty === row.savedQuantity;
  if (unchanged && row.savedAdjusted) return { state: "adjusted", computed };
  if (qty === computed) return { state: "auto", computed };
  return { state: unchanged ? "saved" : "adjusted", computed };
}

const fullName = (row) => `${row.firstName} ${row.lastName}`.trim();
const farmersWord = (n) => (n === 1 ? "farmer" : "farmers");

function DistributionModal({ mode, distribution, commodities, onClose, onSaved }) {
  const editing = mode === "edit";
  const primaryItem = distribution?.items?.[0];

  const [form, setForm] = useState(() =>
    editing
      ? {
          date: distribution.date,
          barangay: distribution.barangay,
          commodityId: primaryItem?.commodityId != null ? String(primaryItem.commodityId) : (commodities[0]?.id ?? ""),
          program: distribution.program ?? "",
          venue: distribution.venue,
          taggedBeneficiaries: [],
          quantity: String(primaryItem?.quantity ?? ""),
          fundingSource: distribution.fundingSource ?? "",
          status: distribution.status,
        }
      : { ...EMPTY_FORM, commodityId: commodities[0]?.id ?? "" },
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(editing);
  // Editing with the tagged farmers not loaded would save an empty list
  // (removing them all), so a load failure blocks Save.
  const [beneficiaryLoadError, setBeneficiaryLoadError] = useState("");
  // Blocks a second Save while the first is still running.
  const savingRef = useRef(false);
  const [pendingFarmer, setPendingFarmer] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  // "Add all eligible farmers": busy flag, and the "Added 12 · skipped 2" line.
  const [addingEligible, setAddingEligible] = useState(false);
  const addingEligibleRef = useRef(false);
  const [eligibleResult, setEligibleResult] = useState(null);
  // Rows whose missing adjustment reason was flagged by the last Save.
  const [showReasonErrors, setShowReasonErrors] = useState(false);
  // Duplicate checks answer for the commodity/program they were asked about;
  // a newer round (commodity or program changed) makes older answers stale.
  const duplicateRound = useRef(0);
  const checkedProgram = useRef(form.program.trim());

  useEscapeToClose(true, onClose);

  // Existing tagged farmers load once with their saved quantity, farm size
  // and adjustment (if any); any farmers added during this edit get theirs
  // computed (or, without a rate, split whatever's left of the total).
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    listDistributionBeneficiaries(distribution.id)
      .then((rows) => {
        if (cancelled) return;
        // Only the item being edited: a distribution seeded with several
        // items keeps its other items' farmers as they are.
        const forItem = primaryItem ? rows.filter((r) => r.commodityId == null || String(r.commodityId) === String(primaryItem.commodityId)) : rows;
        setForm((f) => ({
          ...f,
          taggedBeneficiaries: forItem.map((r) =>
            farmerRow(r, {
              quantity: r.quantity,
              edited: true,
              savedQuantity: round2(r.quantity),
              savedAdjusted: r.adjusted,
              adjustmentReason: r.adjustmentReason ?? "",
              overrideReason: r.overrideReason ?? "",
            }),
          ),
        }));
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

  // The commodity dropdown only lists active, non-deleted commodities — if
  // this distribution's item points at one that's since gone Inactive or
  // been deleted, add it back so editing doesn't silently swap it out.
  const commodityOptions = useMemo(() => {
    if (!editing || !primaryItem || commodities.some((c) => String(c.id) === String(primaryItem.commodityId))) return commodities;
    return [...commodities, { id: primaryItem.commodityId, name: primaryItem.name, unit: primaryItem.unit, packSize: primaryItem.packSize }];
  }, [commodities, editing, primaryItem]);
  const findCommodity = (id) => commodityOptions.find((c) => String(c.id) === String(id)) ?? null;
  const commodity = findCommodity(form.commodityId);
  // The chosen commodity's unit (kg, set, L…) for the quantity fields.
  const unit = commodity?.unit ?? primaryItem?.unit ?? "kg";
  const byFarmSize = hasAllocation(commodity);
  const rows = form.taggedBeneficiaries;
  const states = new Map(rows.map((r) => [r.farmerId, quantityState(r, commodity)]));

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const hasUnresolvedDuplicate = rows.some((r) => r.duplicate);
  const distributionYear = () => new Date(form.date || new Date()).getFullYear();

  // Same commodity, program and year as a distribution the farmer already
  // got: flagged on the row (a reason is then needed to keep them).
  function checkDuplicates(farmers, { commodityId = form.commodityId, program = form.program.trim(), round = duplicateRound.current } = {}) {
    if (!commodityId || !program || farmers.length === 0) return;
    const year = distributionYear();
    for (const farmer of farmers) {
      const farmerId = farmer.id ?? farmer.farmerId;
      checkDuplicateDistribution({ farmerId, commodityId: Number(commodityId), programName: program, year, excludeEventId: editing ? distribution.id : undefined })
        .then((dup) => {
          if (round !== duplicateRound.current) return;
          setForm((f) => ({
            ...f,
            taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, duplicate: dup } : r)),
          }));
        })
        .catch(() => {});
    }
  }

  // A commodity or program change asks every tagged farmer again.
  function recheckAllDuplicates(next) {
    duplicateRound.current += 1;
    const round = duplicateRound.current;
    setForm((f) => ({ ...f, taggedBeneficiaries: f.taggedBeneficiaries.map((r) => ({ ...r, duplicate: null })) }));
    checkDuplicates(rows, { ...next, round });
  }

  // The new farmers' rows: computed from farm size, or (no rate) a share of
  // whatever's left of the total.
  function withNewRows(f, farmers) {
    const known = new Set(f.taggedBeneficiaries.map((r) => r.farmerId));
    const added = farmers
      .filter((farmer) => !known.has(farmer.id))
      .map((farmer) => farmerRow(farmer, { quantity: byFarmSize ? computeAllocation(commodity, farmer.farmSize) : 0, duplicate: farmer.duplicate ?? null }));
    const next = [...f.taggedBeneficiaries, ...added];
    return { ...f, taggedBeneficiaries: byFarmSize ? next : redistributeQuantities(next, f.quantity) };
  }

  function addFarmerRow(farmer) {
    setForm((f) => withNewRows(f, [farmer]));
    checkDuplicates([farmer]);
  }

  function handleAddFarmer(farmer) {
    // Only Inactive farmers need a confirm step (validation is per
    // proof-of-planting submission, never a farmer attribute).
    if (farmer.status !== "Active") {
      setPendingFarmer(farmer);
      return;
    }
    addFarmerRow(farmer);
  }

  function handleRemoveFarmer(farmerId) {
    setForm((f) => {
      const next = f.taggedBeneficiaries.filter((r) => r.farmerId !== farmerId);
      return { ...f, taggedBeneficiaries: byFarmSize ? next : redistributeQuantities(next, f.quantity) };
    });
  }

  function updateRowQuantity(farmerId, value) {
    setForm((f) => ({
      ...f,
      taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, quantity: value, edited: true } : r)),
    }));
  }

  function updateRowReason(farmerId, value) {
    setForm((f) => ({
      ...f,
      taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, adjustmentReason: value } : r)),
    }));
  }

  function updateTotalQuantity(value) {
    setForm((f) => ({ ...f, quantity: value, taggedBeneficiaries: redistributeQuantities(f.taggedBeneficiaries, value) }));
  }

  // A different commodity: rows that weren't adjusted are computed again
  // from the new rate (an adjusted row keeps the admin's quantity and
  // reason). Moving to a commodity without a rate keeps the quantities as
  // they are and makes them the total.
  function changeCommodity(id) {
    const next = findCommodity(id);
    setEligibleResult(null);
    setForm((f) => {
      if (hasAllocation(next)) {
        return {
          ...f,
          commodityId: id,
          taggedBeneficiaries: f.taggedBeneficiaries.map((r) =>
            quantityState(r, commodity).state === "adjusted" ? r : { ...r, quantity: computeAllocation(next, r.currentFarmSize) },
          ),
        };
      }
      const total = round2(f.taggedBeneficiaries.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0));
      return {
        ...f,
        commodityId: id,
        quantity: f.taggedBeneficiaries.length > 0 ? String(total) : f.quantity,
        taggedBeneficiaries: f.taggedBeneficiaries.map((r) => ({ ...r, edited: true })),
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

  // Adds every Active farmer whose crop matches the commodity's category,
  // skipping anyone who already got this commodity under the same program
  // this year (and anyone already tagged).
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
      const eligible = await listEligibleFarmers({
        commodityId: commodity.id,
        programName: program,
        year: distributionYear(),
        excludeEventId: editing ? distribution.id : undefined,
      });
      const tagged = new Set(rows.map((r) => r.farmerId));
      const fresh = eligible.filter((f) => !tagged.has(f.id));
      const toAdd = fresh.filter((f) => !f.duplicate);
      const skipped = fresh.length - toAdd.length;
      const already = eligible.length - fresh.length;
      setForm((f) => withNewRows(f, toAdd));
      if (eligible.length === 0) {
        setEligibleResult({ tone: "info", text: `No Active farmers with a ${commodity.category || "matching"} crop were found.` });
      } else {
        const parts = [`Added ${toAdd.length} eligible ${farmersWord(toAdd.length)}.`];
        if (skipped > 0) parts.push(`Skipped ${skipped} who already received ${commodity.name} under ${program} this year.`);
        if (already > 0) parts.push(`${already} ${already === 1 ? "was" : "were"} already tagged.`);
        setEligibleResult({ tone: "info", text: parts.join(" ") });
      }
    } catch (err) {
      setEligibleResult({ tone: "error", text: friendlyError(err, "Couldn't load the eligible farmers. Check your connection and try again.") });
    } finally {
      addingEligibleRef.current = false;
      setAddingEligible(false);
    }
  }

  const taggedTotal = round2(rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0));
  const totalIsSum = byFarmSize && rows.length > 0;

  // The first problem with the form, in plain words, or "" when it can be
  // saved. (save_distribution checks the same rules again.)
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
    if (hasUnresolvedDuplicate && !overrideReason.trim()) {
      return "One or more tagged farmers already received this commodity under this program this year. Remove them or provide an override reason.";
    }
    if (form.status !== "Ongoing" && rows.length === 0) return `Tag at least one beneficiary before setting the status to ${form.status}.`;
    const total = Number(form.quantity);
    if (rows.length === 0) {
      if (!(total > 0)) return "Enter a total quantity greater than 0.";
      return "";
    }
    const zero = rows.find((r) => !(Number(r.quantity) > 0));
    if (zero) {
      return byFarmSize && !(sizeFor(zero) > 0)
        ? `${fullName(zero)} has no farm size on record. Enter their quantity and a reason, or remove them.`
        : "Each farmer's quantity must be greater than 0.";
    }
    if (byFarmSize) {
      const missing = rows.find((r) => states.get(r.farmerId)?.state === "adjusted" && !r.adjustmentReason.trim());
      if (missing) return `Give a short reason for the adjusted quantity of ${fullName(missing)}.`;
      if (rows.some((r) => r.adjustmentReason.trim().length > MAX_REASON_LENGTH)) return `Keep each adjustment reason to ${MAX_REASON_LENGTH} characters or fewer.`;
    } else if (form.quantity !== "" && total > 0 && Math.abs(taggedTotal - total) > 0.005) {
      return `The farmers' quantities add up to ${formatQuantity(taggedTotal, unit)}, but Total Quantity is ${formatQuantity(total, unit)}. Change them so they match.`;
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
      // Each farmer's acknowledgement isn't sent per row — it follows the
      // distribution's status (Completed = Acknowledged).
      const taggedBeneficiaries = rows.map((r) => ({
        farmerId: r.farmerId,
        quantity: round2(r.quantity),
        overrideReason: r.duplicate ? overrideReason.trim() : r.overrideReason || "",
        adjustmentReason: states.get(r.farmerId)?.state === "adjusted" ? r.adjustmentReason.trim() : "",
      }));
      const quantity = totalIsSum ? taggedTotal : form.quantity;
      const saved = editing
        ? await updateDistribution(distribution.id, {
            date: form.date,
            program,
            venue: form.venue,
            barangay: form.barangay,
            commodityId: form.commodityId,
            quantity,
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

  return (
    <div className="agri-modal-backdrop" onClick={onClose}>
      <form
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "640px" }}
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
            <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {formError}
            </div>
          )}

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

          <div style={{ marginBottom: 14 }}>
            <label className="agri-form-label" htmlFor="distribution-status">Status</label>
            <select id="distribution-status" className="form-select" value={form.status} onChange={(e) => update("status", e.target.value)}>
              {DISTRIBUTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <div className="agri-muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>{STATUS_HELP}</div>
          </div>

          <label className="agri-form-label" htmlFor="distribution-commodity">Commodity</label>
          <select id="distribution-commodity" className="form-select mb-3" value={form.commodityId} onChange={(e) => changeCommodity(e.target.value)} disabled={saving}>
            {commodityOptions.length === 0 && <option value="">No active commodities</option>}
            {commodityOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {byFarmSize && (
            <div className="agri-allocation-info">
              Allocation: {describeAllocation(commodity)}. Each farmer's quantity = farm size × {Number(commodity.allocationPerHectare).toLocaleString()} {unit}/ha.
            </div>
          )}

          <label className="agri-form-label" htmlFor="distribution-program">Program Name <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <input
            id="distribution-program"
            required
            className="form-control mb-3"
            maxLength={120}
            placeholder="e.g. RCEF Seed Distribution"
            value={form.program}
            onChange={(e) => update("program", e.target.value)}
            onBlur={handleProgramBlur}
          />

          <label className="agri-form-label" htmlFor="distribution-venue">Venue</label>
          <input id="distribution-venue" required className="form-control mb-3" maxLength={120} value={form.venue} onChange={(e) => update("venue", e.target.value)} placeholder="e.g. Barangay Hall" />

          <label className="agri-form-label" htmlFor="distribution-total">Total Quantity ({unit})</label>
          {totalIsSum ? (
            <>
              <input id="distribution-total" className="form-control" readOnly value={formatWithBags(taggedTotal, unit, commodity.packSize)} />
              <div className="agri-field-hint mb-3">The sum of the farmers' quantities below.</div>
            </>
          ) : (
            <>
              <input
                id="distribution-total"
                required
                type="number"
                min="0"
                className="form-control"
                value={form.quantity}
                onChange={(e) => updateTotalQuantity(e.target.value)}
              />
              <div className="agri-field-hint mb-3">
                {byFarmSize
                  ? "Tag farmers below and each one's quantity is computed from their farm size."
                  : commodity
                    ? "Split equally among the tagged farmers. Set an allocation per hectare in Commodities to compute this automatically."
                    : ""}
              </div>
            </>
          )}

          <label className="agri-form-label">
            Beneficiaries <span style={{ color: "var(--agri-red)" }}>*</span>
          </label>
          {loadingBeneficiaries ? (
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginBottom: 10 }}>Loading tagged farmers…</div>
          ) : beneficiaryLoadError ? (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{beneficiaryLoadError}</div>
          ) : (
            <>
              <FarmerTagInput
                taggedFarmers={rows.map((r) => ({ ...r, duplicateWarning: !!r.duplicate }))}
                onAddFarmer={handleAddFarmer}
                onRemoveFarmer={handleRemoveFarmer}
                disabled={saving}
              />
              <div className="agri-add-eligible-row">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-2"
                  onClick={addAllEligible}
                  disabled={saving || addingEligible || !commodity}
                >
                  {addingEligible ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" /> : <Users size={14} />}
                  {addingEligible ? "Adding…" : "Add all eligible farmers"}
                </button>
                {eligibleResult ? (
                  <span className="agri-add-eligible-result" role="status" style={eligibleResult.tone === "error" ? { color: "var(--agri-red)" } : undefined}>
                    {eligibleResult.text}
                  </span>
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
                    <tr><th>Farmer</th><th className="agri-col-farm">Crop · Farm Size</th><th>Qty ({unit})</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const { state, computed } = states.get(row.farmerId) ?? { state: "manual", computed: null };
                      const bags = formatBags(row.quantity, commodity?.packSize);
                      const reasonMissing = showReasonErrors && state === "adjusted" && !row.adjustmentReason.trim();
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
                              <div className="agri-beneficiary-meta agri-beneficiary-farm-inline">
                                {row.cropType || "—"} · {formatHectares(sizeFor(row))}
                              </div>
                              {row.duplicate && (
                                <div className="agri-beneficiary-duplicate-warning">
                                  Already received {formatQuantity(row.duplicate.quantity, unit)} from {row.duplicate.program} on {formatDate(row.duplicate.date)}
                                </div>
                              )}
                            </td>
                            <td className="agri-col-farm">
                              <div>{row.cropType || "—"}</div>
                              <div className="agri-beneficiary-meta">{formatHectares(sizeFor(row))}</div>
                            </td>
                            <td className="agri-beneficiary-qty-cell">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="agri-beneficiary-qty-input"
                                aria-label={`Quantity for ${fullName(row)} (${unit})`}
                                value={row.quantity}
                                onChange={(e) => updateRowQuantity(row.farmerId, e.target.value)}
                                disabled={saving}
                              />
                              {state === "adjusted" && <span className="agri-tag-adjusted">Adjusted</span>}
                              {(bags || state === "adjusted" || state === "saved") && (
                                <span className="agri-beneficiary-sub">
                                  {[
                                    bags,
                                    state === "adjusted" && computed !== null ? `computed ${formatQuantity(computed, unit)}` : "",
                                    state === "saved" ? "as saved before" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </td>
                          </tr>
                          {state === "adjusted" && (
                            <tr className="agri-beneficiary-reason-row">
                              <td colSpan={3}>
                                <input
                                  className={`agri-beneficiary-reason-input${reasonMissing ? " is-invalid" : ""}`}
                                  aria-label={`Reason for adjusting ${fullName(row)}'s quantity`}
                                  maxLength={MAX_REASON_LENGTH}
                                  placeholder={
                                    computed > 0
                                      ? `Reason for changing from ${formatQuantity(computed, unit)} (required)`
                                      : "No farm size on record: reason for this quantity (required)"
                                  }
                                  value={row.adjustmentReason}
                                  onChange={(e) => updateRowReason(row.farmerId, e.target.value)}
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
              <div className="agri-muted" style={{ fontSize: "0.75rem", margin: "6px 0" }}>
                {rows.length} {farmersWord(rows.length)} tagged · {formatWithBags(taggedTotal, unit, commodity?.packSize)} total
              </div>
            </>
          )}

          {hasUnresolvedDuplicate && (
            <div style={{ marginBottom: 14 }}>
              <label className="agri-form-label">
                Reason for allowing repeat distribution <span style={{ color: "var(--agri-red)" }}>*</span>
              </label>
              <textarea
                required
                className="form-control"
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why these farmers are being tagged again this year"
              />
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

          <div className="mb-3" />

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

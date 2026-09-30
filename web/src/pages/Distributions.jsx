import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, Printer, Trash2, Truck, X } from "lucide-react";
import Pill, { STATUS_COLOR } from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import FarmerTagInput from "../components/distributions/FarmerTagInput.jsx";
import { distributionTotalQty } from "../data/mockData.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import {
  checkDuplicateDistribution,
  createDistribution,
  deleteDistribution,
  listDistributionBeneficiaries,
  listDistributions,
  updateDistribution,
  updateDistributionStatus,
} from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";
import { friendlyError } from "../lib/friendlyError.js";

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

// Scheduled -> Ongoing or Cancelled; Ongoing -> Completed or Cancelled;
// Completed/Cancelled are final (empty list = read-only badge, no menu).
const STATUS_TRANSITIONS = {
  Scheduled: ["Ongoing", "Cancelled"],
  Ongoing: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};
const FINAL_STATUSES = new Set(["Completed", "Cancelled"]);
const STATUS_DOT_COLOR = {
  green: "var(--agri-primary-dark)",
  red: "var(--agri-red)",
  orange: "var(--agri-orange)",
  blue: "var(--agri-blue)",
  purple: "var(--agri-purple)",
  gray: "#667066",
};

const EMPTY_FORM = {
  commodityId: "",
  program: "",
  venue: "",
  taggedBeneficiaries: [],
  quantity: "",
  fundingSource: "",
  acknowledgementStatus: "Pending",
};

export default function Distributions() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const { data: distributions, setData: setDistributions, loading, error: loadError } = useSupabaseList(listDistributions);
  const [commodities, setCommodities] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
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
          <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
            {isMAO && (
              <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({ mode: "add" })}>
                <Plus size={16} /> New Distribution
              </button>
            )}

            <select className="form-select" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              <option value="Completed">Completed</option>
              <option value="Ongoing">Ongoing</option>
              <option value="Scheduled">Scheduled</option>
            </select>

            <select className="form-select" style={{ width: 200 }} value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
              <option value="All">All Programs</option>
              {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table">
              <thead>
                <tr><th>Date</th><th>Crop Type</th><th>Program</th><th>Beneficiaries</th><th>Quantity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((d) => (
                  <tr key={d.id} className={d.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(d.id)}>
                    <td>{d.date}</td>
                    <td>{d.cropType}</td>
                    <td className="agri-cell-truncate" title={d.program || undefined}>
                      {d.program || <span className="agri-muted">—</span>}
                    </td>
                    <td>
                      {d.taggedBeneficiaryCount > 0 ? (
                        `${d.taggedBeneficiaryCount} tagged`
                      ) : (
                        <span className="agri-muted">{d.beneficiaries} farmers (not tagged)</span>
                      )}
                    </td>
                    <td>{distributionTotalQty(d).toLocaleString()} kg</td>
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

          <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
            Showing {pageItems.length} of {filtered.length} distributions
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>

        {selected && (
          <div className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Distribution Details</div>
              <DistributionStatusControl
                distribution={selected}
                canEdit={isMAO}
                onSaved={(updated) => {
                  setDistributions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                  setToast({ tone: "success", message: `Status updated to ${updated.status}.` });
                }}
                onError={(message) => setToast({ tone: "error", message })}
              />
            </div>
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginBottom: 10 }}>
              {selected.date}
            </div>

            <div className="agri-detail-body">
            <div className="agri-detail-row"><div><div className="agri-detail-label">Program</div>{selected.program}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay</div>{selected.barangay}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Venue</div>{selected.venue}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Funding Source</div>{selected.fundingSource || "—"}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Acknowledgement Status</div><Pill status={selected.acknowledgementStatus} /></div></div>
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
                  <thead><tr><th>Farmer</th><th>RSBSA No.</th><th>Qty</th></tr></thead>
                  <tbody>
                    {beneficiaryRows.map((row) => (
                      <tr key={row.claimId}>
                        <td>
                          {row.firstName} {row.lastName}
                          {row.farmerDeleted && <span className="agri-muted"> (removed)</span>}
                        </td>
                        <td>{row.rsbsaNo}</td>
                        <td>{row.quantity.toLocaleString()}</td>
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

            <div className="agri-detail-actions">
              <button
                className="btn btn-agri-primary agri-detail-btn w-100 d-flex align-items-center justify-content-center gap-2"
                onClick={() => window.open(`/print/distributions/${selected.id}?autoPrint=1`, "_blank", "noopener,noreferrer")}
              >
                <Printer size={16} /> Print Distribution Report
              </button>

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

// Read-only Pill for everyone else, or once a distribution has reached a
// final status. Admins on a non-final status get a pill-styled trigger that
// opens a menu of just the allowed next statuses; Completed/Cancelled go
// through a confirmation dialog first since they can't be undone.
function DistributionStatusControl({ distribution, canEdit, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);

  const nextOptions = STATUS_TRANSITIONS[distribution.status] ?? [];

  useEscapeToClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!canEdit || nextOptions.length === 0) {
    return <Pill status={distribution.status} />;
  }

  async function applyStatus(newStatus) {
    setSaving(true);
    try {
      const updated = await updateDistributionStatus(distribution.id, newStatus);
      onSaved(updated);
    } catch (err) {
      onError(friendlyError(err, "Failed to update status."));
    } finally {
      setSaving(false);
    }
  }

  function handleSelect(newStatus) {
    setOpen(false);
    if (newStatus === "Completed" && (distribution.taggedBeneficiaryCount ?? 0) === 0) {
      onError("Tag at least one beneficiary before marking this distribution as Completed.");
      return;
    }
    if (FINAL_STATUSES.has(newStatus)) {
      setPendingStatus(newStatus);
    } else {
      applyStatus(newStatus);
    }
  }

  const color = STATUS_COLOR[distribution.status] ?? "gray";

  return (
    <div className="agri-status-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`agri-pill ${color} agri-status-trigger d-flex align-items-center`}
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {distribution.status}
        <ChevronDown size={12} style={{ marginLeft: 2 }} />
      </button>

      {open && (
        <div className="agri-status-menu" role="menu">
          {nextOptions.map((s) => (
            <button key={s} type="button" className="agri-status-menu-item" role="menuitem" onClick={() => handleSelect(s)}>
              <span className="agri-status-dot" style={{ background: STATUS_DOT_COLOR[STATUS_COLOR[s] ?? "gray"] }} />
              {s}
            </button>
          ))}
        </div>
      )}

      {pendingStatus && (
        <ConfirmDialog
          title={`Mark ${distribution.program} (${distribution.date}) as ${pendingStatus}?`}
          message="This can't be undone."
          confirmLabel={pendingStatus}
          onConfirm={() => {
            const s = pendingStatus;
            setPendingStatus(null);
            applyStatus(s);
          }}
          onCancel={() => setPendingStatus(null)}
        />
      )}
    </div>
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
          acknowledgementStatus: distribution.acknowledgementStatus,
        }
      : { ...EMPTY_FORM, commodityId: commodities[0]?.id ?? "" },
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(editing);
  const [pendingFarmer, setPendingFarmer] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");

  useEscapeToClose(true, onClose);

  // Existing tagged farmers load once and keep their saved qty (edited:
  // true so redistributeQuantities leaves them alone); any new chips added
  // during this edit split whatever's left of the total evenly.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    listDistributionBeneficiaries(distribution.id)
      .then((rows) => {
        if (cancelled) return;
        setForm((f) => ({
          ...f,
          taggedBeneficiaries: rows.map((r) => ({
            farmerId: r.farmerId,
            firstName: r.firstName,
            lastName: r.lastName,
            rsbsaNo: r.rsbsaNo,
            barangay: r.barangay,
            status: "Active",
            validationStatus: "Validated",
            farmerDeleted: r.farmerDeleted,
            quantity: r.quantity,
            acknowledgementStatus: r.acknowledgementStatus,
            overrideReason: r.overrideReason ?? "",
            edited: true,
            duplicate: null,
          })),
        }));
      })
      .catch(() => {})
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
    return [...commodities, { id: primaryItem.commodityId, name: primaryItem.name }];
  }, [commodities, editing, primaryItem]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const hasUnresolvedDuplicate = form.taggedBeneficiaries.some((r) => r.duplicate);

  function runDuplicateCheck(farmer) {
    const program = form.program.trim();
    if (!form.commodityId || !program) return;
    const year = new Date(form.date || new Date()).getFullYear();
    checkDuplicateDistribution({
      farmerId: farmer.id,
      commodityId: Number(form.commodityId),
      programName: program,
      year,
      excludeEventId: editing ? distribution.id : undefined,
    })
      .then((dup) => {
        setForm((f) => ({
          ...f,
          taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmer.id ? { ...r, duplicate: dup } : r)),
        }));
      })
      .catch(() => {});
  }

  function addFarmerRow(farmer) {
    setForm((f) => {
      if (f.taggedBeneficiaries.some((r) => r.farmerId === farmer.id)) return f;
      const newRow = {
        farmerId: farmer.id,
        firstName: farmer.firstName,
        lastName: farmer.lastName,
        rsbsaNo: farmer.rsbsaNo,
        barangay: farmer.barangay,
        status: farmer.status,
        validationStatus: farmer.validationStatus,
        quantity: 0,
        acknowledgementStatus: "Pending",
        overrideReason: "",
        edited: false,
        duplicate: null,
      };
      return { ...f, taggedBeneficiaries: redistributeQuantities([...f.taggedBeneficiaries, newRow], f.quantity) };
    });
    runDuplicateCheck(farmer);
  }

  function handleAddFarmer(farmer) {
    if (farmer.status !== "Active" || farmer.validationStatus !== "Validated") {
      setPendingFarmer(farmer);
      return;
    }
    addFarmerRow(farmer);
  }

  function handleRemoveFarmer(farmerId) {
    setForm((f) => ({
      ...f,
      taggedBeneficiaries: redistributeQuantities(f.taggedBeneficiaries.filter((r) => r.farmerId !== farmerId), f.quantity),
    }));
  }

  function updateRowQuantity(farmerId, value) {
    setForm((f) => ({
      ...f,
      taggedBeneficiaries: f.taggedBeneficiaries.map((r) => (r.farmerId === farmerId ? { ...r, quantity: value, edited: true } : r)),
    }));
  }

  function updateTotalQuantity(value) {
    setForm((f) => ({ ...f, quantity: value, taggedBeneficiaries: redistributeQuantities(f.taggedBeneficiaries, value) }));
  }

  const taggedTotal = form.taggedBeneficiaries.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.commodityId) {
      setFormError("Add a commodity in Commodities before recording a distribution.");
      return;
    }
    const program = form.program.trim();
    if (!program) {
      setFormError("Program name is required.");
      return;
    }
    if (hasUnresolvedDuplicate && !overrideReason.trim()) {
      setFormError("One or more tagged farmers already received this commodity under this program this year. Remove them or provide an override reason.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      // acknowledgement_status stays "Pending" on every claim row — receipt
      // acknowledgement is now set once for the whole distribution via the
      // Acknowledgement Status dropdown below, not per farmer.
      const taggedBeneficiaries = form.taggedBeneficiaries.map((r) => ({
        farmerId: r.farmerId,
        quantity: Number(r.quantity) || 0,
        acknowledgementStatus: "Pending",
        overrideReason: r.duplicate ? overrideReason.trim() : r.overrideReason || "",
      }));
      const saved = editing
        ? await updateDistribution(distribution.id, {
            date: form.date,
            program,
            venue: form.venue,
            barangay: form.barangay,
            beneficiaries: String(taggedBeneficiaries.length),
            commodityId: form.commodityId,
            quantity: form.quantity,
            itemId: primaryItem?.itemId ?? null,
            fundingSource: form.fundingSource,
            acknowledgementStatus: form.acknowledgementStatus,
            taggedBeneficiaries,
          })
        : await createDistribution({
            program,
            venue: form.venue,
            beneficiaries: String(taggedBeneficiaries.length),
            commodityId: form.commodityId,
            quantity: form.quantity,
            fundingSource: form.fundingSource,
            acknowledgementStatus: form.acknowledgementStatus,
            taggedBeneficiaries,
          });
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this distribution. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div className="agri-card" style={{ width: 460, maxWidth: "92vw", padding: 22, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="agri-panel-header">
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{editing ? "Edit Distribution" : "New Distribution"}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {formError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {formError}
            </div>
          )}

          {editing && (
            <div className="row g-3 mb-3">
              <div className="col-6">
                <label className="agri-form-label">Date</label>
                <input required type="date" className="form-control" value={form.date} onChange={(e) => update("date", e.target.value)} />
              </div>
              <div className="col-6">
                <label className="agri-form-label">Barangay</label>
                <input required className="form-control" value={form.barangay} onChange={(e) => update("barangay", e.target.value)} />
              </div>
            </div>
          )}

          {editing && (
            <div style={{ marginBottom: 14 }}>
              <div className="agri-form-label" style={{ marginBottom: 4 }}>Status</div>
              <Pill status={distribution.status} />
              <div className="agri-muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                Change status from the badge in Distribution Details.
              </div>
            </div>
          )}

          <label className="agri-form-label">Commodity</label>
          <select className="form-select mb-3" value={form.commodityId} onChange={(e) => update("commodityId", e.target.value)}>
            {commodityOptions.length === 0 && <option value="">No active commodities</option>}
            {commodityOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <label className="agri-form-label">Program Name <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <input
            required
            className="form-control mb-3"
            placeholder="e.g. RCEF Seed Distribution"
            value={form.program}
            onChange={(e) => update("program", e.target.value)}
          />

          <label className="agri-form-label">Venue</label>
          <input required className="form-control mb-3" value={form.venue} onChange={(e) => update("venue", e.target.value)} placeholder="e.g. Barangay Hall" />

          <label className="agri-form-label">Total Quantity (kg)</label>
          <input
            required
            type="number"
            min="0"
            className="form-control mb-3"
            value={form.quantity}
            onChange={(e) => updateTotalQuantity(e.target.value)}
          />

          <label className="agri-form-label">
            Beneficiaries <span style={{ color: "var(--agri-red)" }}>*</span>
          </label>
          {loadingBeneficiaries ? (
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginBottom: 10 }}>Loading tagged farmers…</div>
          ) : (
            <FarmerTagInput
              taggedFarmers={form.taggedBeneficiaries.map((r) => ({ ...r, duplicateWarning: !!r.duplicate }))}
              onAddFarmer={handleAddFarmer}
              onRemoveFarmer={handleRemoveFarmer}
              disabled={saving}
            />
          )}

          {form.taggedBeneficiaries.length > 0 && (
            <>
              <div className="agri-beneficiary-table-wrap">
                <table className="agri-table">
                  <thead><tr><th>Farmer</th><th>Qty</th></tr></thead>
                  <tbody>
                    {form.taggedBeneficiaries.map((row) => (
                      <tr key={row.farmerId}>
                        <td>
                          {row.firstName} {row.lastName}
                          {row.farmerDeleted && <span className="agri-muted"> (removed)</span>}
                          {row.duplicate && (
                            <div className="agri-beneficiary-duplicate-warning">
                              Already received {row.duplicate.quantity} from {row.duplicate.program} on {row.duplicate.date}
                            </div>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="agri-beneficiary-qty-input"
                            value={row.quantity}
                            onChange={(e) => updateRowQuantity(row.farmerId, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="agri-muted" style={{ fontSize: "0.75rem", margin: "6px 0" }}>
                {form.taggedBeneficiaries.length} farmers tagged · {taggedTotal.toLocaleString()} kg total
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
              message={`This farmer is ${pendingFarmer.status !== "Active" ? "inactive" : "not yet validated"}. Add them to this distribution anyway?`}
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

          <div className="row g-3 mb-3">
            <div className="col-6">
              <label className="agri-form-label">Funding Source</label>
              <input className="form-control" placeholder="e.g. DA Regional Field Office IX" value={form.fundingSource} onChange={(e) => update("fundingSource", e.target.value)} />
            </div>
            <div className="col-6">
              <label className="agri-form-label">Acknowledgement Status</label>
              <select className="form-select" value={form.acknowledgementStatus} onChange={(e) => update("acknowledgementStatus", e.target.value)}>
                <option>Pending</option>
                <option>Acknowledged</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Save Distribution"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

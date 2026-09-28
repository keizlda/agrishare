import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, Printer, Trash2, Truck, X } from "lucide-react";
import Pill, { STATUS_COLOR } from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import { distributionTotalQty } from "../data/mockData.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { createDistribution, deleteDistribution, listDistributions, updateDistribution, updateDistributionStatus } from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";

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

const OTHER_PROGRAM = "Other (specify)";
const EMPTY_FORM = {
  commodityId: "",
  program: "",
  programOther: "",
  venue: "",
  beneficiaries: "",
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

  useEffect(() => {
    listCommodities()
      .then((rows) => setCommodities(rows.filter((c) => c.status === "Active")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId && distributions.length > 0) setSelectedId(distributions[0].id);
  }, [distributions, selectedId]);

  const programOptions = useMemo(
    () => [...new Set(distributions.map((d) => d.program).filter(Boolean))].sort(),
    [distributions],
  );

  const filtered = useMemo(
    () =>
      distributions.filter(
        (d) => (statusFilter === "All" || d.status === statusFilter) && (programFilter === "All" || d.program === programFilter),
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
                    <td>{d.beneficiaries}</td>
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
          programOptions={programOptions}
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
      onError(err.message || "Failed to update status.");
    } finally {
      setSaving(false);
    }
  }

  function handleSelect(newStatus) {
    setOpen(false);
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
      onError(err.message || "Failed to delete distribution.");
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

function DistributionModal({ mode, distribution, commodities, programOptions, onClose, onSaved }) {
  const editing = mode === "edit";
  const primaryItem = distribution?.items?.[0];

  const [form, setForm] = useState(() =>
    editing
      ? {
          date: distribution.date,
          barangay: distribution.barangay,
          commodityId: primaryItem?.commodityId != null ? String(primaryItem.commodityId) : (commodities[0]?.id ?? ""),
          program: programOptions.includes(distribution.program) ? distribution.program : OTHER_PROGRAM,
          programOther: programOptions.includes(distribution.program) ? "" : distribution.program,
          venue: distribution.venue,
          beneficiaries: String(distribution.beneficiaries ?? ""),
          quantity: String(primaryItem?.quantity ?? ""),
          fundingSource: distribution.fundingSource ?? "",
          acknowledgementStatus: distribution.acknowledgementStatus,
        }
      : { ...EMPTY_FORM, commodityId: commodities[0]?.id ?? "" },
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEscapeToClose(true, onClose);

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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.commodityId) {
      setFormError("Add a commodity in Commodities before recording a distribution.");
      return;
    }
    const program = form.program === OTHER_PROGRAM ? form.programOther.trim() : form.program;
    if (!program) {
      setFormError("Program name is required.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const saved = editing
        ? await updateDistribution(distribution.id, {
            date: form.date,
            program,
            venue: form.venue,
            barangay: form.barangay,
            beneficiaries: form.beneficiaries,
            commodityId: form.commodityId,
            quantity: form.quantity,
            itemId: primaryItem?.itemId ?? null,
            fundingSource: form.fundingSource,
            acknowledgementStatus: form.acknowledgementStatus,
          })
        : await createDistribution({
            program,
            venue: form.venue,
            beneficiaries: form.beneficiaries,
            commodityId: form.commodityId,
            quantity: form.quantity,
            fundingSource: form.fundingSource,
            acknowledgementStatus: form.acknowledgementStatus,
          });
      onSaved(saved);
    } catch (err) {
      setFormError(err.message);
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
          <select className="form-select mb-2" value={form.program} onChange={(e) => update("program", e.target.value)}>
            <option value="">Select a program…</option>
            {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value={OTHER_PROGRAM}>{OTHER_PROGRAM}</option>
          </select>
          {form.program === OTHER_PROGRAM && (
            <input
              required
              className="form-control mb-3"
              placeholder="Enter the new program name"
              value={form.programOther}
              onChange={(e) => update("programOther", e.target.value)}
            />
          )}
          {form.program !== OTHER_PROGRAM && <div className="mb-3" />}

          <label className="agri-form-label">Venue</label>
          <input required className="form-control mb-3" value={form.venue} onChange={(e) => update("venue", e.target.value)} placeholder="e.g. Barangay Hall" />

          <div className="row g-3 mb-3">
            <div className="col-6">
              <label className="agri-form-label">Beneficiaries</label>
              <input required type="number" min="0" className="form-control" value={form.beneficiaries} onChange={(e) => update("beneficiaries", e.target.value)} />
            </div>
            <div className="col-6">
              <label className="agri-form-label">Quantity (kg)</label>
              <input required type="number" min="0" className="form-control" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} />
            </div>
          </div>

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

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { commodityCategories, computeCommodityStats } from "../data/mockData.js";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.js";
import { createCommodity, deleteCommodity, listCommodities, setCommodityStatus, updateCommodity } from "../lib/api/commodities.js";
import { listDistributions } from "../lib/api/distributions.js";
import { formatDate } from "../lib/dates.js";
import { friendlyError } from "../lib/friendlyError.js";
import { rowLinkProps } from "../lib/rowLink.js";

// Inline edit (Commodity Details card): the fields that become inputs.
function editFormFor(commodity) {
  return { name: commodity.name, category: commodity.category, unit: commodity.unit ?? "kg", status: commodity.status };
}

function validateEdit(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = "Enter the commodity name.";
  if (!form.unit.trim()) errors.unit = "Enter a unit, e.g. kg, bag or set.";
  return errors;
}

export default function Commodities() {
  const { data: commodities, setData: setCommodities, loading, error: loadError } = useSupabaseList(listCommodities);
  const [distributions, setDistributions] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // Inline edit of the selected commodity: null in view mode.
  const [edit, setEdit] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // A row click or page change held back by "Discard changes?": a function
  // that carries it out.
  const [pendingLeave, setPendingLeave] = useState(null);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId && commodities.length > 0) setSelectedId(commodities[0].id);
  }, [commodities, selectedId]);

  const filtered = useMemo(() => {
    return commodities.filter((c) => {
      const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "All" || c.category === categoryFilter;
      const matchesStatus = statusFilter === "All" || c.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [commodities, search, categoryFilter, statusFilter]);

  // Rows per page = however many fit in the full-height table area (min 5).
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, pageSize);
  useCardLabels(tableRef);
  const detailRef = useRef(null);
  const revealDetail = useRevealDetail(detailRef);

  const selected = commodities.find((c) => c.id === selectedId) ?? null;
  const { totals } = computeCommodityStats(commodities, distributions);
  const selectedDistributedQty = selected ? (totals[selected.name] ?? 0) : 0;

  const original = edit && selected ? editFormFor(selected) : null;
  const dirty = !!original && Object.keys(original).some((k) => edit[k] !== original[k]);

  useUnsavedChangesGuard(dirty, (go) => setPendingLeave(() => go));

  function stopEditing() {
    setEdit(null);
    setEditErrors({});
  }

  function selectRow(id) {
    if (id === selectedId) {
      revealDetail();
      return;
    }
    const go = () => {
      stopEditing();
      setSelectedId(id);
      revealDetail();
    };
    if (dirty) setPendingLeave(() => go);
    else go();
  }

  function updateField(key, value) {
    setEdit((f) => ({ ...f, [key]: value }));
    if (editErrors[key]) setEditErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (saving) return;
    const errors = validateEdit(edit);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const saved = await updateCommodity(selected.id, { name: edit.name.trim(), category: edit.category, unit: edit.unit.trim(), status: edit.status });
      setCommodities((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      stopEditing();
      setToast({ tone: "success", message: "Commodity updated." });
    } catch (err) {
      setEditErrors({ form: friendlyError(err, "Couldn't save this commodity. Please try again.") });
    } finally {
      setSaving(false);
    }
  }

  // Soft delete: the commodity keeps its row (and its name in past
  // distribution/request records) but disappears from every listing/picker.
  async function handleDelete(commodity) {
    setPendingDelete(null);
    setActionError("");
    try {
      await deleteCommodity(commodity.id);

      // Selection moves to the next row in the current filtered order (or the
      // previous one if it was last); pagination clamps itself if the page empties.
      if (selectedId === commodity.id) {
        const idx = filtered.findIndex((c) => c.id === commodity.id);
        const neighbour = filtered[idx + 1] ?? filtered[idx - 1] ?? null;
        setSelectedId(neighbour ? neighbour.id : null);
      }
      setCommodities((prev) => prev.filter((c) => c.id !== commodity.id));
      setToast({ tone: "success", message: "Commodity deleted." });
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't delete the commodity.") });
    }
  }

  async function toggleStatus(id) {
    setActionError("");
    const current = commodities.find((c) => c.id === id);
    if (!current) return;
    const nextStatus = current.status === "Active" ? "Inactive" : "Active";
    try {
      await setCommodityStatus(id, nextStatus);
      setCommodities((prev) => prev.map((c) => (c.id === id ? { ...c, status: nextStatus } : c)));
    } catch (err) {
      setActionError(friendlyError(err, "Couldn't update this commodity's status."));
    }
  }

  // View and edit mode share one card: the same rows in the same order (each
  // value becomes an input), and the button row at the bottom keeps its
  // place — Edit | Delete, or Cancel | Save Changes.
  const Card = edit ? "form" : "div";

  return (
    <div className="agri-fill-root">
      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div className="agri-toolbar">
            <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setAdding(true)}>
              <Plus size={16} /> Add Commodity
            </button>
            <div className="agri-toolbar-search">
              <Search size={15} />
              <input className="form-control" placeholder="Search commodity" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "150px" }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All Categories</option>
              {commodityCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "130px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Date Added</th></tr></thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.id} {...rowLinkProps(() => selectRow(c.id), { selected: c.id === selectedId })}>
                    <td><span className="agri-row-title">{c.name}</span></td>
                    <td>{c.category}</td>
                    <td><Pill status={c.status} /></td>
                    <td>{formatDate(c.dateAdded)}</td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={4} className="agri-muted text-center py-4">Loading commodities…</td></tr>
                )}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <EmptyState
                icon={Package}
                title="No commodities found"
                hint={search || categoryFilter !== "All" || statusFilter !== "All" ? "Try a different search or clear the filters." : "Add a commodity to make it available for distribution."}
              />
            )}
          </div>
          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["commodity", "commodities"]} />
        </div>

        {selected && (
          <Card ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }} {...(edit ? { onSubmit: saveEdit, noValidate: true } : {})}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>{edit ? "Edit Commodity" : "Commodity Details"}</div>
              <Pill status={selected.status} />
            </div>
            <div className="agri-detail-body">
              {edit && editErrors.form && (
                <div className="agri-pill red" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{editErrors.form}</div>
              )}
              {edit ? (
                <>
                  <EditField label="Name" id="commodity-name" error={editErrors.name}>
                    <input id="commodity-name" className={`form-control form-control-sm${editErrors.name ? " is-invalid" : ""}`} value={edit.name} onChange={(e) => updateField("name", e.target.value)} disabled={saving} autoFocus />
                  </EditField>
                  <EditField label="Category" id="commodity-category">
                    <select id="commodity-category" className="form-select form-select-sm" value={edit.category} onChange={(e) => updateField("category", e.target.value)} disabled={saving}>
                      {[...new Set([edit.category, ...commodityCategories])].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </EditField>
                  <EditField label="Unit" id="commodity-unit" error={editErrors.unit}>
                    <input id="commodity-unit" className={`form-control form-control-sm${editErrors.unit ? " is-invalid" : ""}`} value={edit.unit} onChange={(e) => updateField("unit", e.target.value)} disabled={saving} placeholder="e.g. kg, bag, set" />
                  </EditField>
                </>
              ) : (
                <>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Name</div>{selected.name}</div></div>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Category</div>{selected.category}</div></div>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Unit</div>{selected.unit}</div></div>
                </>
              )}
              <div className="agri-detail-row"><div><div className="agri-detail-label">Total Distributed</div>{selectedDistributedQty.toLocaleString()} kg</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Date Added</div>{formatDate(selected.dateAdded)}</div></div>

              <label className="agri-form-label" style={{ marginTop: 14 }} htmlFor="commodity-status-select">Status</label>
              {edit ? (
                <select id="commodity-status-select" className="form-select mb-3" value={edit.status} onChange={(e) => updateField("status", e.target.value)} disabled={saving}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              ) : (
                <select id="commodity-status-select" className="form-select mb-3" value={selected.status} onChange={() => toggleStatus(selected.id)}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              )}
            </div>

            <div className="agri-detail-actions">
              {edit ? (
                <div className="agri-detail-actions-row">
                  <button type="button" className="btn agri-detail-btn agri-detail-btn-edit d-flex align-items-center justify-content-center gap-2" onClick={stopEditing} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-agri-primary agri-detail-btn d-flex align-items-center justify-content-center gap-2" disabled={saving}>
                    {saving ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" /> : <Check size={16} />}
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              ) : (
                <div className="agri-detail-actions-row">
                  <button
                    type="button"
                    className="btn agri-detail-btn agri-detail-btn-edit d-flex align-items-center justify-content-center gap-2"
                    onClick={() => setEdit(editFormFor(selected))}
                  >
                    <Pencil size={16} /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn agri-detail-btn agri-detail-btn-delete d-flex align-items-center justify-content-center gap-2"
                    onClick={() => setPendingDelete(selected)}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {adding && (
        <AddCommodityModal
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setCommodities((prev) => [saved, ...prev]);
            setToast({ tone: "success", message: "Commodity added." });
            setAdding(false);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          message="It will be removed from the commodity list and can't be selected for new distributions. Past distribution records will keep showing it."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingLeave && (
        <ConfirmDialog
          title="Discard changes?"
          message={`Your changes to ${selected?.name ?? "this commodity"} haven't been saved.`}
          confirmLabel="Discard"
          onConfirm={() => {
            const go = pendingLeave;
            setPendingLeave(null);
            stopEditing();
            go();
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

// One field of the inline edit form, laid out like a detail row so each
// input sits where its value was; the error shows right under the input.
function EditField({ label, id, error, children }) {
  return (
    <div className="agri-detail-row">
      <div style={{ flex: 1 }}>
        <label className="agri-detail-label" htmlFor={id}>{label}</label>
        {children}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    </div>
  );
}

function AddCommodityModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", category: "Rice" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEscapeToClose(true, onClose);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      onSaved(await createCommodity(form));
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this commodity. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-modal-backdrop" onClick={onClose}>
      <form
        className="agri-card agri-modal"
        style={{ "--agri-modal-width": "420px" }}
        role="dialog"
        aria-label="Add Commodity"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">Add Commodity</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {formError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {formError}
            </div>
          )}

          <label className="agri-form-label">Commodity Name</label>
          <input required className="form-control mb-3" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Rice Seeds (NSIC Rc222)" />

          <label className="agri-form-label">Category</label>
          <select className="form-select" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {commodityCategories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Commodity"}</button>
        </div>
      </form>
    </div>
  );
}

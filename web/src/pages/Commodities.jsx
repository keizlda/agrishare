import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import TypesEditor from "../components/commodities/TypesEditor.jsx";
import { typeRowsFor, typeRowsToSave, validateTypeRows } from "../lib/commodityTypeRows.js";
import { computeCommodityStats } from "../data/mockData.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.js";
import { deleteCommodity, listCommodities, saveCommodity, setCommodityStatus } from "../lib/api/commodities.js";
import { listDistributions } from "../lib/api/distributions.js";
import { describeRates } from "../lib/allocation.js";
import { formatDate } from "../lib/dates.js";
import { formatQuantity } from "../lib/quantity.js";
import { friendlyError } from "../lib/friendlyError.js";
import { rowLinkProps } from "../lib/rowLink.js";

const isKg = (unit) => String(unit ?? "").trim().toLowerCase() === "kg";

// Inline edit (Commodity Details card): the fields that become inputs.
function editFormFor(commodity) {
  return { name: commodity.name, category: commodity.category, unit: commodity.unit ?? "kg", status: commodity.status, types: typeRowsFor(commodity) };
}
const sameForm = (a, b) => JSON.stringify({ ...a, types: a.types.map(({ key: _k, ...r }) => r) }) === JSON.stringify({ ...b, types: b.types.map(({ key: _k, ...r }) => r) });

const MAX_NAME_LENGTH = 80;
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Name rules shared by Add and Edit: required, a sensible length, and not
// another active commodity's name (ignoring case and spaces — the database
// refuses duplicates too). `others`: the other commodities.
function nameError(name, others) {
  if (!name.trim()) return "Enter the commodity name.";
  if (name.trim().length > MAX_NAME_LENGTH) return `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
  if (others.some((c) => sameName(c.name, name))) return "A commodity with this name already exists.";
  return null;
}

function validateForm(form, others) {
  const errors = {};
  const name = nameError(form.name, others);
  if (name) errors.name = name;
  if (!form.category.trim()) errors.category = "Enter a category, e.g. Rice or Fertilizer.";
  if (!form.unit.trim()) errors.unit = "Enter a unit, e.g. kg, set or head.";
  const typeErrors = validateTypeRows(form.types);
  if (Object.keys(typeErrors).length) errors.types = typeErrors;
  if (form.types.some((t) => !t.removed) && !isKg(form.unit)) errors.unit = "Types and rates are only for commodities measured in kg.";
  return errors;
}

// Category suggestions: whatever categories exist (nothing hardcoded).
function CategoryInput({ id, value, onChange, categories, invalid, disabled }) {
  return (
    <>
      <input id={id} list={`${id}-list`} className={`form-control form-control-sm${invalid ? " is-invalid" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="e.g. Rice" maxLength={40} />
      <datalist id={`${id}-list`}>
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
    </>
  );
}

export default function Commodities() {
  const { user } = useAuth();
  // The Farmers' Association President can view commodities and their
  // rates; only the MAO Admin changes them (the database enforces this too).
  const canEdit = user?.role === "MAO Admin";
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
  const [edit, setEdit] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(null);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId && commodities.length > 0) setSelectedId(commodities[0].id);
  }, [commodities, selectedId]);

  const categories = useMemo(() => [...new Set(commodities.map((c) => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [commodities]);

  const filtered = useMemo(() => {
    return commodities.filter((c) => {
      const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "All" || c.category === categoryFilter;
      const matchesStatus = statusFilter === "All" || c.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [commodities, search, categoryFilter, statusFilter]);

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
  const dirty = !!original && !sameForm(edit, original);

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
    const errors = validateForm(edit, commodities.filter((c) => c.id !== selected.id));
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const saved = await saveCommodity(
        selected.id,
        { name: edit.name.trim().replace(/\s+/g, " "), category: edit.category.trim(), unit: edit.unit.trim(), status: edit.status },
        typeRowsToSave(edit.types),
      );
      setCommodities((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      stopEditing();
      setToast({ tone: "success", message: "Commodity updated." });
    } catch (err) {
      setEditErrors({ form: friendlyError(err, "Couldn't save this commodity. Please try again.") });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(commodity) {
    setPendingDelete(null);
    setActionError("");
    try {
      await deleteCommodity(commodity.id);
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
            {canEdit && (
              <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setAdding(true)}>
                <Plus size={16} /> Add Commodity
              </button>
            )}
            <div className="agri-toolbar-search">
              <Search size={15} />
              <input className="form-control" placeholder="Search commodity" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "150px" }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
              <option value="All">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "130px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead><tr><th>Name</th><th>Category</th><th>Types / Rate</th><th>Status</th><th>Date Added</th></tr></thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.id} {...rowLinkProps(() => selectRow(c.id), { selected: c.id === selectedId })}>
                    <td><span className="agri-row-title">{c.name}</span></td>
                    <td>{c.category}</td>
                    <td className="agri-cell-truncate" title={describeRates(c)}>{describeRates(c)}</td>
                    <td><Pill status={c.status} /></td>
                    <td>{formatDate(c.dateAdded)}</td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={5} className="agri-muted text-center py-4">Loading commodities…</td></tr>
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
                <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{editErrors.form}</div>
              )}
              {edit ? (
                <>
                  <EditField label="Name" id="commodity-name" error={editErrors.name}>
                    <input id="commodity-name" maxLength={MAX_NAME_LENGTH} className={`form-control form-control-sm${editErrors.name ? " is-invalid" : ""}`} value={edit.name} onChange={(e) => updateField("name", e.target.value)} disabled={saving} autoFocus />
                  </EditField>
                  <EditField label="Category" id="commodity-category" error={editErrors.category}>
                    <CategoryInput id="commodity-category" value={edit.category} onChange={(v) => updateField("category", v)} categories={categories} invalid={!!editErrors.category} disabled={saving} />
                  </EditField>
                  <EditField label="Unit" id="commodity-unit" error={editErrors.unit}>
                    <input id="commodity-unit" className={`form-control form-control-sm${editErrors.unit ? " is-invalid" : ""}`} value={edit.unit} onChange={(e) => updateField("unit", e.target.value)} disabled={saving} placeholder="e.g. kg, set" />
                  </EditField>
                  <div className="agri-detail-section-title">Types and rates</div>
                  {isKg(edit.unit) || edit.types.some((t) => !t.removed) ? (
                    <TypesEditor rows={edit.types} onChange={(rows) => updateField("types", rows)} errors={editErrors.types} disabled={saving} idPrefix="edit-type" />
                  ) : (
                    <div className="agri-field-hint" style={{ marginTop: 0 }}>Types and kg-per-hectare rates are for commodities measured in kg.</div>
                  )}
                </>
              ) : (
                <>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Name</div>{selected.name}</div></div>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Category</div>{selected.category}</div></div>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Unit</div>{selected.unit}</div></div>
                  <div className="agri-detail-section-title">Types and rates</div>
                  {selected.types.length ? (
                    <>
                      <ul className="agri-rate-list">
                        {selected.types.map((t) => (
                          <li key={t.id}>
                            <span>{t.name} — {t.rate.toLocaleString()} kg/ha</span>
                            {t.isDefault && <span className="agri-filed-tag">Default</span>}
                          </li>
                        ))}
                      </ul>
                      {selected.typesUpdatedAt && (
                        <div className="agri-field-hint">Last updated {formatDate(selected.typesUpdatedAt)}{selected.typesUpdatedBy ? ` by ${selected.typesUpdatedBy}` : ""}</div>
                      )}
                    </>
                  ) : (
                    <div className="agri-muted" style={{ fontSize: "0.82rem" }}>No types. Distributions of this commodity split the total equally.</div>
                  )}
                </>
              )}
              <div className="agri-detail-row" style={{ marginTop: 10 }}><div><div className="agri-detail-label">Total Distributed</div>{formatQuantity(selectedDistributedQty, selected.unit)}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Date Added</div>{formatDate(selected.dateAdded)}</div></div>

              {canEdit && (
                <>
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
                </>
              )}
            </div>

            {canEdit && (
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
                    <button type="button" className="btn agri-detail-btn agri-detail-btn-edit d-flex align-items-center justify-content-center gap-2" onClick={() => setEdit(editFormFor(selected))}>
                      <Pencil size={16} /> Edit
                    </button>
                    <button type="button" className="btn agri-detail-btn agri-detail-btn-delete d-flex align-items-center justify-content-center gap-2" onClick={() => setPendingDelete(selected)}>
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      {adding && (
        <AddCommodityModal
          existing={commodities}
          categories={categories}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setCommodities((prev) => [saved, ...prev]);
            setSelectedId(saved.id);
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
function EditField({ label, id, error, hint, children }) {
  return (
    <div className="agri-detail-row">
      <div style={{ flex: 1 }}>
        <label className="agri-detail-label" htmlFor={id}>{label}</label>
        {children}
        {error ? <div className="invalid-feedback d-block">{error}</div> : hint && <div className="agri-field-hint">{hint}</div>}
      </div>
    </div>
  );
}

function AddCommodityModal({ existing, categories, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", category: categories[0] ?? "", unit: "kg", status: "Active", types: [] });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEscapeToClose(true, onClose);

  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (savingRef.current) return;
    setFormError("");
    const found = validateForm(form, existing);
    setErrors(found);
    if (Object.keys(found).length) return;
    savingRef.current = true;
    setSaving(true);
    try {
      onSaved(await saveCommodity(null, { name: form.name.trim().replace(/\s+/g, " "), category: form.category.trim(), unit: form.unit.trim(), status: "Active" }, typeRowsToSave(form.types)));
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this commodity. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="agri-modal-backdrop" onClick={onClose}>
      <form
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "520px" }}
        role="dialog"
        aria-label="Add Commodity"
        onSubmit={handleSubmit}
        noValidate
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">Add Commodity</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {formError && (
            <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{formError}</div>
          )}
          <label className="agri-form-label" htmlFor="add-commodity-name">Commodity Name <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <input
            id="add-commodity-name"
            maxLength={MAX_NAME_LENGTH}
            className={`form-control${errors.name ? " is-invalid" : ""}`}
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. Yellow Corn Seeds"
            autoFocus
          />
          {errors.name && <div className="invalid-feedback d-block">{errors.name}</div>}

          <div className="row g-3 mt-0 mb-2">
            <div className="col-7">
              <label className="agri-form-label" htmlFor="add-commodity-category">Category <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <CategoryInput id="add-commodity-category" value={form.category} onChange={(v) => update("category", v)} categories={categories} invalid={!!errors.category} disabled={saving} />
              {errors.category && <div className="invalid-feedback d-block">{errors.category}</div>}
            </div>
            <div className="col-5">
              <label className="agri-form-label" htmlFor="add-commodity-unit">Unit <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <input id="add-commodity-unit" className={`form-control form-control-sm${errors.unit ? " is-invalid" : ""}`} value={form.unit} onChange={(e) => update("unit", e.target.value)} placeholder="kg" maxLength={20} />
              {errors.unit && <div className="invalid-feedback d-block">{errors.unit}</div>}
            </div>
          </div>

          <div className="agri-detail-section-title">Types and rates (optional)</div>
          <div className="agri-field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
            For kg commodities: each type's kg per hectare. A farmer's quantity = farm size × their type's rate.
          </div>
          <TypesEditor rows={form.types} onChange={(rows) => update("types", rows)} errors={errors.types} disabled={saving} idPrefix="add-type" />
        </div>
        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Commodity"}</button>
        </div>
      </form>
    </div>
  );
}

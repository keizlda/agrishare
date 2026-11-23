import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { computeCommodityStats } from "../data/mockData.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.js";
import { COMMODITY_CATEGORIES, categoryOption, deleteCommodity, listCommodities, saveCommodity } from "../lib/api/commodities.js";
import { listDistributions } from "../lib/api/distributions.js";
import { formatRate } from "../lib/allocation.js";
import { formatDate } from "../lib/dates.js";
import { formatQuantity } from "../lib/quantity.js";
import { friendlyError } from "../lib/friendlyError.js";
import { rowLinkProps } from "../lib/rowLink.js";

const isKg = (unit) => String(unit ?? "").trim().toLowerCase() === "kg";
const MAX_NAME_LENGTH = 80;
const MAX_RATE = 1000;
const RATE_HINT = "Leave blank for items not given by hectare (quantities are then split equally or entered manually).";

// Inline edit (Commodity Details card): the fields that become inputs.
function editFormFor(commodity) {
  return { name: commodity.name, category: categoryOption(commodity.category), rate: commodity.rate == null ? "" : String(commodity.rate) };
}
const sameForm = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The rules shared by Add and Edit (the database checks the same). `others`:
// the other commodities; `unit`: the commodity's unit (new ones are kg).
function validateForm(form, others, unit = "kg") {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Enter the commodity name.";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
  else if (others.some((c) => sameName(c.name, name))) errors.name = "A commodity with this name already exists.";
  if (!form.category.trim()) errors.category = "Choose a category.";
  const rate = form.rate.trim();
  if (rate) {
    if (!isKg(unit)) errors.rate = "An allocation per hectare is only for commodities measured in kg.";
    else if (!/^\d+(\.\d{1,2})?$/.test(rate) || Number(rate) <= 0) errors.rate = "Enter the kg per hectare as a number above 0, with up to 2 decimals.";
    else if (Number(rate) > MAX_RATE) errors.rate = `Enter up to ${MAX_RATE.toLocaleString()} kg per hectare.`;
  }
  return errors;
}

// Category dropdown. A stored category that isn't one of the choices (from
// before the list) stays selectable so editing doesn't change it.
function CategorySelect({ id, value, onChange, invalid, disabled, small }) {
  const options = COMMODITY_CATEGORIES.includes(value) || !value ? COMMODITY_CATEGORIES : [value, ...COMMODITY_CATEGORIES];
  return (
    <select id={id} className={`form-select${small ? " form-select-sm" : ""}${invalid ? " is-invalid" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {!value && <option value="">Choose a category</option>}
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// "Allocation (kg per hectare)": a number with "kg/ha" shown inside, right.
function RateInput({ id, value, onChange, invalid, disabled, small }) {
  return (
    <div className="agri-unit-input">
      <input
        id={id}
        inputMode="decimal"
        className={`form-control${small ? " form-control-sm" : ""} text-end${invalid ? " is-invalid" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="e.g. 40"
        aria-describedby={`${id}-hint`}
      />
      <span className="agri-unit-input-unit" aria-hidden="true">kg/ha</span>
    </div>
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

  // Filter choices: the listed categories plus any older stored ones.
  const categories = useMemo(() => {
    const stored = commodities.map((c) => categoryOption(c.category)).filter(Boolean);
    return [...new Set([...COMMODITY_CATEGORIES, ...stored])];
  }, [commodities]);

  const filtered = useMemo(() => {
    return commodities.filter((c) => {
      const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "All" || categoryOption(c.category) === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [commodities, search, categoryFilter]);

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
    const errors = validateForm(edit, commodities.filter((c) => c.id !== selected.id), selected.unit);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const saved = await saveCommodity(selected.id, {
        name: edit.name.trim().replace(/\s+/g, " "),
        category: edit.category,
        rate: edit.rate.trim(),
      });
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

          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards agri-commodity-table">
              <colgroup>
                <col style={{ width: "31%" }} />
                <col style={{ width: "23%" }} />
                <col style={{ width: "23%" }} />
                <col style={{ width: "23%" }} />
              </colgroup>
              <thead><tr><th>Name</th><th>Category</th><th>Rate</th><th>Date Added</th></tr></thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.id} {...rowLinkProps(() => selectRow(c.id), { selected: c.id === selectedId })}>
                    <td><span className="agri-row-title">{c.name}</span></td>
                    <td>{categoryOption(c.category)}</td>
                    <td>{formatRate(c.rate)}</td>
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
                hint={search || categoryFilter !== "All" ? "Try a different search or clear the filters." : "Add a commodity to make it available for distribution."}
              />
            )}
          </div>
          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["commodity", "commodities"]} />
        </div>

        {selected && (
          <Card ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }} {...(edit ? { onSubmit: saveEdit, noValidate: true } : {})}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>{edit ? "Edit Commodity" : "Commodity Details"}</div>
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
                    <CategorySelect id="commodity-category" value={edit.category} onChange={(v) => updateField("category", v)} invalid={!!editErrors.category} disabled={saving} small />
                  </EditField>
                  {isKg(selected.unit) ? (
                    <EditField label="Allocation (kg per hectare)" id="commodity-rate" error={editErrors.rate} hint={RATE_HINT}>
                      <RateInput id="commodity-rate" value={edit.rate} onChange={(v) => updateField("rate", v)} invalid={!!editErrors.rate} disabled={saving} small />
                    </EditField>
                  ) : (
                    <div className="agri-detail-row"><div><div className="agri-detail-label">Allocation</div><span className="agri-muted">Measured in {selected.unit}, so it isn't given by hectare.</span></div></div>
                  )}
                </>
              ) : (
                <>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Name</div>{selected.name}</div></div>
                  <div className="agri-detail-row"><div><div className="agri-detail-label">Category</div>{categoryOption(selected.category)}</div></div>
                  <div className="agri-detail-row">
                    <div>
                      <div className="agri-detail-label">Allocation</div>
                      {selected.rate != null ? `${selected.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/ha` : <span className="agri-muted">Not set</span>}
                      {selected.rateUpdatedAt && (
                        <div className="agri-field-hint">Last updated {formatDate(selected.rateUpdatedAt)}{selected.rateUpdatedBy ? ` by ${selected.rateUpdatedBy}` : ""}</div>
                      )}
                    </div>
                  </div>
                  {!isKg(selected.unit) && <div className="agri-detail-row"><div><div className="agri-detail-label">Unit</div>{selected.unit}</div></div>}
                </>
              )}
              <div className="agri-detail-row"><div><div className="agri-detail-label">Total Distributed</div>{formatQuantity(selectedDistributedQty, selected.unit)}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Date Added</div>{formatDate(selected.dateAdded)}</div></div>
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
        {error ? <div className="invalid-feedback d-block">{error}</div> : hint && <div className="agri-field-hint" id={`${id}-hint`}>{hint}</div>}
      </div>
    </div>
  );
}

function AddCommodityModal({ existing, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", category: "", rate: "" });
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
      onSaved(await saveCommodity(null, { name: form.name.trim().replace(/\s+/g, " "), category: form.category, rate: form.rate.trim() }));
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
            placeholder="e.g. Rice Seeds – Hybrid"
            autoFocus
          />
          {errors.name && <div className="invalid-feedback d-block">{errors.name}</div>}
          <div className="agri-field-hint">Give each variety its own commodity, e.g. "Rice Seeds – Inbred (RCEF)" and "Rice Seeds – Hybrid".</div>

          <div className="row g-3 mt-0 mb-2">
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="add-commodity-category">Category <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <CategorySelect id="add-commodity-category" value={form.category} onChange={(v) => update("category", v)} invalid={!!errors.category} disabled={saving} />
              {errors.category && <div className="invalid-feedback d-block">{errors.category}</div>}
            </div>
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor="add-commodity-rate">Allocation (kg per hectare)</label>
              <RateInput id="add-commodity-rate" value={form.rate} onChange={(v) => update("rate", v)} invalid={!!errors.rate} disabled={saving} />
              {errors.rate && <div className="invalid-feedback d-block">{errors.rate}</div>}
            </div>
          </div>
          <div className="agri-field-hint" id="add-commodity-rate-hint" style={{ marginTop: 0 }}>{RATE_HINT} Quantities are in kilograms.</div>
        </div>
        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Commodity"}</button>
        </div>
      </form>
    </div>
  );
}

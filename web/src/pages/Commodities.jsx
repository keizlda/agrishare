import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { commodityCategories, computeCommodityStats } from "../data/mockData.js";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { countCommodityDistributions, createCommodity, deleteCommodity, listCommodities, setCommodityStatus, updateCommodity } from "../lib/api/commodities.js";
import { listDistributions } from "../lib/api/distributions.js";

export default function Commodities() {
  const { data: commodities, setData: setCommodities, loading, error: loadError } = useSupabaseList(listCommodities);
  const [distributions, setDistributions] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", commodity }
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

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

  const selected = commodities.find((c) => c.id === selectedId) ?? null;
  const { totals } = computeCommodityStats(commodities, distributions);
  const selectedDistributedQty = selected ? (totals[selected.name] ?? 0) : 0;

  // Not-deleted distributions using it block the delete up front; the DB's
  // ON DELETE RESTRICT is the backstop if anything slips past this check.
  async function handleDelete(commodity) {
    setPendingDelete(null);
    setActionError("");
    try {
      const used = await countCommodityDistributions(commodity.id);
      if (used > 0) {
        setToast({
          tone: "error",
          message: `This commodity is used in ${used} distribution${used === 1 ? "" : "s"} and can't be deleted. Set it to Inactive instead.`,
        });
        return;
      }
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
      setToast({ tone: "error", message: err.message || "Couldn't delete the commodity." });
    }
  }

  function resetFilters() {
    setSearch("");
    setCategoryFilter("All");
    setStatusFilter("All");
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
      setActionError(err.message);
    }
  }

  return (
    <div className="agri-fill-root">
      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
            <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({ mode: "add" })}>
              <Plus size={16} /> Add Commodity
            </button>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
              <input className="form-control" placeholder="Search commodity" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 150 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All Categories</option>
              {commodityCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="form-select" style={{ width: 130 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            <button type="button" className="agri-icon-btn" title="Reset filters" aria-label="Reset filters" onClick={resetFilters}>
              <Filter size={16} />
            </button>
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table">
              <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Date Added</th><th>Actions</th></tr></thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(c.id)}>
                    <td>{c.name}</td>
                    <td>{c.category}</td>
                    <td><Pill status={c.status} /></td>
                    <td>{c.dateAdded}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="agri-icon-btn"
                        title="Edit"
                        aria-label={`Edit ${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setModal({ mode: "edit", commodity: c }); }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="agri-icon-btn"
                        title="Delete"
                        aria-label={`Delete ${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}
                      >
                        <Trash2 size={14} color="var(--agri-red)" />
                      </button>
                    </div>
                    </td>
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
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>

        {selected && (
          <div className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Commodity Details</div>
              <Pill status={selected.status} />
            </div>
            <div className="agri-detail-body">
            <div className="agri-detail-row"><div><div className="agri-detail-label">Name</div>{selected.name}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Category</div>{selected.category}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Total Distributed</div>{selectedDistributedQty.toLocaleString()} kg</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Date Added</div>{selected.dateAdded}</div></div>

            <label className="agri-form-label" style={{ marginTop: 14 }} htmlFor="commodity-status-select">Status</label>
            <select id="commodity-status-select" className="form-select mb-3" value={selected.status} onChange={() => toggleStatus(selected.id)}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
            </div>

            <div className="agri-detail-actions">
              <button
                className="btn btn-agri-primary w-100 d-flex align-items-center justify-content-center gap-2"
                onClick={() => setModal({ mode: "edit", commodity: selected })}
              >
                <Pencil size={15} /> Edit Commodity
              </button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <CommodityModal
          mode={modal.mode}
          commodity={modal.commodity}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            if (modal.mode === "edit") {
              setCommodities((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
              setToast({ tone: "success", message: "Commodity updated." });
            } else {
              setCommodities((prev) => [saved, ...prev]);
              setToast({ tone: "success", message: "Commodity added." });
            }
            setModal(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          message="This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function CommodityModal({ mode, commodity, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    mode === "edit" ? { name: commodity.name, category: commodity.category } : { name: "", category: "Rice" },
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEscapeToClose(true, onClose);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const saved = mode === "edit" ? await updateCommodity(commodity.id, form) : await createCommodity(form);
      onSaved(saved);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div className="agri-card" style={{ width: 420, maxWidth: "92vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="agri-panel-header">
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{mode === "edit" ? "Edit Commodity" : "Add Commodity"}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {formError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {formError}
            </div>
          )}

          <label className="agri-form-label">Commodity Name</label>
          <input required className="form-control mb-3" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Rice Seeds (NSIC Rc222)" />

          <label className="agri-form-label">Category</label>
          <select className="form-select mb-3" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {commodityCategories.map((c) => <option key={c}>{c}</option>)}
          </select>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Commodity"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

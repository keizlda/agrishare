import { useEffect, useMemo, useState } from "react";
import { Filter, Package, Pencil, Plus, Search, TrendingUp, Users, X } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import Toast from "../components/ui/Toast.jsx";
import { commodityCategories, computeCommodityStats } from "../data/mockData.js";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { createCommodity, listCommodities, setCommodityStatus, updateCommodity } from "../lib/api/commodities.js";
import { listDistributions } from "../lib/api/distributions.js";
import { listFarmers } from "../lib/api/farmers.js";

const PAGE_SIZE = 5;

export default function Commodities() {
  const { data: commodities, setData: setCommodities, loading, error: loadError } = useSupabaseList(listCommodities);
  const [distributions, setDistributions] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", commodity }
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
    listFarmers().then(setFarmers).catch(() => {});
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

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);

  const selected = commodities.find((c) => c.id === selectedId) ?? null;
  const { totals, mostDistributedName, mostDistributedQty, totalQuantity } = computeCommodityStats(commodities, distributions);
  const selectedDistributedQty = selected ? (totals[selected.name] ?? 0) : 0;

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
    <div>
      <OverviewDrawer>
        <StatCard icon={Package} label="Total Commodities" value={commodities.length} sub="Active commodities" color="green" />
        <StatCard icon={TrendingUp} label="Most Distributed" value={mostDistributedName.split(" ")[0]} sub={`${mostDistributedQty.toLocaleString()} kg this month`} color="blue" />
        <StatCard icon={Package} label="Total Quantity" value={totalQuantity.toLocaleString()} sub="Distributed to date (kg)" color="purple" />
        <StatCard icon={Users} label="Farmers Using" value={farmers.length} sub="Farmers benefited" color="orange" />
      </OverviewDrawer>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1.6fr 1fr" : "1fr", gap: 16 }}>
        <div className="agri-card" style={{ padding: 16 }}>
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

          <div className="agri-table-wrap">
            <table className="agri-table">
              <thead><tr><th>Commodity ID</th><th>Name</th><th>Category</th><th>Status</th><th>Date Added</th><th>Actions</th></tr></thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(c.id)}>
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.category}</td>
                    <td><Pill status={c.status} /></td>
                    <td>{c.dateAdded}</td>
                    <td>
                      <button
                        type="button"
                        className="agri-icon-btn"
                        title="Edit"
                        aria-label={`Edit ${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setModal({ mode: "edit", commodity: c }); }}
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Loading commodities…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">No commodities match your search/filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>

        {selected && (
          <div className="agri-card" style={{ padding: 18, alignSelf: "flex-start" }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Commodity Details</div>
              <Pill status={selected.status} />
            </div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Name</div>{selected.name}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity ID</div>{selected.id}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Category</div>{selected.category}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Total Distributed</div>{selectedDistributedQty.toLocaleString()} kg</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Date Added</div>{selected.dateAdded}</div></div>

            <label className="agri-form-label" style={{ marginTop: 14 }} htmlFor="commodity-status-select">Status</label>
            <select id="commodity-status-select" className="form-select mb-3" value={selected.status} onChange={() => toggleStatus(selected.id)}>
              <option>Active</option>
              <option>Inactive</option>
            </select>

            <button
              className="btn btn-agri-primary w-100 d-flex align-items-center justify-content-center gap-2"
              onClick={() => setModal({ mode: "edit", commodity: selected })}
            >
              <Pencil size={15} /> Edit Commodity
            </button>
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

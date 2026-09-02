import { useMemo, useState } from "react";
import { Filter, Pencil, Plus, Power, Search, Trash2, X } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import { Users, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { commodityCategories, computeFarmerStats } from "../data/mockData.js";
import { createFarmer, deleteFarmer, listFarmers, setFarmerStatus } from "../lib/api/farmers.js";

const PAGE_SIZE = 5;

// Farmers page only offers actual crop commodities in its dropdowns — Farm
// Tools/Livestock are program categories (still valid on the Commodities
// page), not something a farmer record is planted with.
const FARMER_COMMODITY_OPTIONS = commodityCategories.filter((c) => c !== "Farm Tools" && c !== "Livestock");

const EMPTY_FORM = {
  rsbsaNo: "", firstName: "", lastName: "", sex: "Male", birthDate: "",
  contactNo: "", barangay: "Langapud", commodity: "Rice", farmSize: "", farmLocation: "Langapud",
};

export default function Farmers() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const { data: farmers, setData: setFarmers, loading, error: loadError } = useSupabaseList(listFarmers);
  const [search, setSearch] = useState("");
  const [commodityFilter, setCommodityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [actionError, setActionError] = useState("");

  const stats = computeFarmerStats(farmers);

  const filtered = useMemo(() => {
    return farmers.filter((f) => {
      const fullName = `${f.firstName} ${f.lastName}`.toLowerCase();
      const matchesSearch = !search || fullName.includes(search.toLowerCase()) || f.rsbsaNo.includes(search);
      const matchesCommodity = commodityFilter === "All" || f.commodity === commodityFilter;
      const matchesStatus = statusFilter === "All" || f.status === statusFilter;
      return matchesSearch && matchesCommodity && matchesStatus;
    });
  }, [farmers, search, commodityFilter, statusFilter]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);

  async function handleAddFarmer(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const newFarmer = await createFarmer(form);
      setFarmers((prev) => [newFarmer, ...prev]);
      setForm(EMPTY_FORM);
      setShowModal(false);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setActionError("");
    try {
      await deleteFarmer(id);
      setFarmers((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPendingDelete(null);
    }
  }

  async function handleToggleStatus(id) {
    setActionError("");
    const current = farmers.find((f) => f.id === id);
    if (!current) return;
    const nextStatus = current.status === "Active" ? "Inactive" : "Active";
    try {
      await setFarmerStatus(id, nextStatus);
      setFarmers((prev) => prev.map((f) => (f.id === id ? { ...f, status: nextStatus } : f)));
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={Users} label="Total Farmers" value={stats.total} sub="All registered farmers" color="green" />
        <StatCard icon={ShieldCheck} label="Validated" value={stats.validated} sub={`${Math.round((stats.validated / (stats.total || 1)) * 100)}% of total`} color="blue" />
        <StatCard icon={ShieldX} label="Not Validated" value={stats.total - stats.validated} sub={`${Math.round(((stats.total - stats.validated) / (stats.total || 1)) * 100)}% of total`} color="orange" />
      </OverviewDrawer>

      <div className="agri-card" style={{ padding: 16 }}>
        {(loadError || actionError) && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
            {loadError || actionError}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
            <input
              className="form-control"
              placeholder="Search farmer by name or RSBSA no."
              style={{ paddingLeft: 32 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="form-select" style={{ width: 170 }} value={commodityFilter} onChange={(e) => setCommodityFilter(e.target.value)}>
            <option value="All">All Commodities</option>
            {FARMER_COMMODITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="form-select" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <button className="agri-icon-btn"><Filter size={16} /></button>

          {isMAO && (
            <button className="btn btn-agri-primary ms-auto d-flex align-items-center gap-2" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Add Farmer
            </button>
          )}
        </div>

        <div className="agri-table-wrap">
          <table className="agri-table">
            <thead>
              <tr>
                <th>RSBSA No.</th><th>Full Name</th><th>Sex</th><th>Birth Date</th><th>Contact No.</th>
                <th>Barangay</th><th>Commodity</th><th>Farm Size</th><th>Farm Location</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((f) => (
                <tr key={f.id}>
                  <td>{f.rsbsaNo}</td>
                  <td>{f.firstName} {f.lastName}</td>
                  <td>{f.sex}</td>
                  <td>{f.birthDate}</td>
                  <td>{f.contactNo}</td>
                  <td>{f.barangay}</td>
                  <td>{f.commodity}</td>
                  <td>{f.farmSize} ha</td>
                  <td>{f.farmLocation}</td>
                  <td><Pill status={f.status} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {isMAO ? (
                        <>
                          <button className="agri-icon-btn" title="Edit"><Pencil size={14} /></button>
                          <button className="agri-icon-btn" title="Delete" onClick={() => setPendingDelete(f)}>
                            <Trash2 size={14} color="var(--agri-red)" />
                          </button>
                        </>
                      ) : (
                        <button
                          className="agri-icon-btn"
                          title={f.status === "Active" ? "Mark Inactive" : "Mark Active"}
                          onClick={() => handleToggleStatus(f.id)}
                        >
                          <Power size={14} color={f.status === "Active" ? "var(--agri-red)" : "var(--agri-primary)"} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={11} className="agri-muted text-center py-4">Loading farmers…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={11} className="agri-muted text-center py-4">No farmer records match your search/filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
          Showing {pageItems.length} of {filtered.length} farmers
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {showModal && (
        <FarmerModal
          form={form}
          setForm={setForm}
          error={formError}
          saving={saving}
          onClose={() => setShowModal(false)}
          onSubmit={handleAddFarmer}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete Farmer Record?"
          message={`This will permanently remove ${pendingDelete.firstName} ${pendingDelete.lastName} (${pendingDelete.rsbsaNo}) from the system. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function FarmerModal({ form, setForm, error, saving, onClose, onSubmit }) {
  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div className="agri-card" style={{ width: 520, maxWidth: "92vw", padding: 22, maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="agri-panel-header">
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Add Farmer</div>
          <button className="agri-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {error && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="row g-3">
            <Field label="RSBSA Number" col={12}>
              <input required className="form-control" value={form.rsbsaNo} onChange={(e) => update("rsbsaNo", e.target.value)} placeholder="2024-01-002-000XXX" />
            </Field>
            <Field label="First Name" col={6}>
              <input required className="form-control" value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
            </Field>
            <Field label="Last Name" col={6}>
              <input required className="form-control" value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
            </Field>
            <Field label="Sex" col={4}>
              <select className="form-select" value={form.sex} onChange={(e) => update("sex", e.target.value)}>
                <option>Male</option><option>Female</option>
              </select>
            </Field>
            <Field label="Birth Date" col={4}>
              <input required type="date" className="form-control" value={form.birthDate} onChange={(e) => update("birthDate", e.target.value)} />
            </Field>
            <Field label="Contact No." col={4}>
              <input required className="form-control" value={form.contactNo} onChange={(e) => update("contactNo", e.target.value)} placeholder="09XX XXX XXXX" />
            </Field>
            <Field label="Commodity" col={6}>
              <select className="form-select" value={form.commodity} onChange={(e) => update("commodity", e.target.value)}>
                {FARMER_COMMODITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Farm Size (ha)" col={6}>
              <input required type="number" step="0.01" min="0" className="form-control" value={form.farmSize} onChange={(e) => update("farmSize", e.target.value)} />
            </Field>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Farmer"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, col, children }) {
  return (
    <div className={`col-${col}`}>
      <label className="agri-form-label">{label}</label>
      {children}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Calendar, Filter, Package, Plus, Printer, Truck, Users, X } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import { distributionTotalQty } from "../data/mockData.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { createDistribution, listDistributions } from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";

const EMPTY_FORM = { commodityId: "", program: "", venue: "", beneficiaries: "", quantity: "" };
const PAGE_SIZE = 5;

export default function Distributions() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const { data: distributions, setData: setDistributions, loading, error: loadError } = useSupabaseList(listDistributions);
  const [commodities, setCommodities] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCommodities()
      .then((rows) => {
        const active = rows.filter((c) => c.status === "Active");
        setCommodities(active);
        setForm((f) => (f.commodityId ? f : { ...f, commodityId: active[0]?.id ?? "" }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId && distributions.length > 0) setSelectedId(distributions[0].id);
  }, [distributions, selectedId]);

  const filtered = useMemo(
    () => distributions.filter((d) => statusFilter === "All" || d.status === statusFilter),
    [distributions, statusFilter],
  );

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);

  const selected = distributions.find((d) => d.id === selectedId) ?? null;

  const totalBeneficiaries = distributions.reduce((sum, d) => sum + d.beneficiaries, 0);
  const totalQuantity = distributions.reduce((sum, d) => sum + distributionTotalQty(d), 0);
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const thisMonth = distributions.filter((d) => d.date.startsWith(thisMonthKey)).length;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.commodityId) {
      setFormError("Add a commodity in Commodities before recording a distribution.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const newDist = await createDistribution({
        program: form.program,
        venue: form.venue,
        beneficiaries: form.beneficiaries,
        commodityId: form.commodityId,
        quantity: form.quantity,
      });
      setDistributions((prev) => [newDist, ...prev]);
      setSelectedId(newDist.id);
      setForm((f) => ({ ...EMPTY_FORM, commodityId: f.commodityId }));
      setShowModal(false);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={Truck} label="Total Distributions" value={distributions.length} sub="All time distributions" color="green" />
        <StatCard icon={Users} label="Total Beneficiaries" value={totalBeneficiaries.toLocaleString()} sub="Farmers who received" color="blue" />
        <StatCard icon={Package} label="Total Quantity" value={totalQuantity.toLocaleString()} sub="All commodities (kg)" color="purple" />
        <StatCard icon={Calendar} label="This Month" value={thisMonth} sub="Distributions this month" color="orange" />
      </OverviewDrawer>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1.6fr 1fr" : "1fr", gap: 16 }}>
        <div className="agri-card" style={{ padding: 16 }}>
          {loadError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
            {isMAO && (
              <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setShowModal(true)}>
                <Plus size={16} /> New Distribution
              </button>
            )}

            <select className="form-select" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              <option value="Completed">Completed</option>
              <option value="Ongoing">Ongoing</option>
            </select>

            <button className="agri-icon-btn ms-auto"><Filter size={16} /></button>
          </div>

          <div className="agri-table-wrap">
            <table className="agri-table">
              <thead>
                <tr><th>Distribution ID</th><th>Date</th><th>Crop Type</th><th>Barangay</th><th>Beneficiaries</th><th>Quantity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((d) => (
                  <tr key={d.id} className={d.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(d.id)}>
                    <td>{d.id}</td>
                    <td>{d.date}</td>
                    <td>{d.cropType}</td>
                    <td>{d.barangay}</td>
                    <td>{d.beneficiaries}</td>
                    <td>{distributionTotalQty(d).toLocaleString()} kg</td>
                    <td><Pill status={d.status} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={7} className="agri-muted text-center py-4">Loading distributions…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="agri-muted text-center py-4">No distributions match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>

        {selected && (
          <div className="agri-card" style={{ padding: 18, alignSelf: "flex-start" }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Distribution Details</div>
              <Pill status={selected.status} />
            </div>
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginBottom: 10 }}>
              {selected.id} · {selected.date}
            </div>

            <div className="agri-detail-row"><div><div className="agri-detail-label">Program</div>{selected.program}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay</div>{selected.barangay}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Venue</div>{selected.venue}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Total Beneficiaries</div>{selected.beneficiaries} Farmers</div></div>
            {selected.remarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Remarks</div>{selected.remarks}</div></div>
            )}

            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 16, marginBottom: 8 }}>Items Distributed</div>
            <div className="agri-table-wrap" style={{ marginBottom: 14 }}>
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

            <button className="btn btn-agri-primary w-100 d-flex align-items-center justify-content-center gap-2">
              <Printer size={15} /> Print Distribution Report
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowModal(false)}>
          <div className="agri-card" style={{ width: 460, maxWidth: "92vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>New Distribution</div>
              <button className="agri-icon-btn" onClick={() => setShowModal(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              {formError && (
                <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
                  {formError}
                </div>
              )}

              <label className="agri-form-label">Commodity</label>
              <select className="form-select mb-3" value={form.commodityId} onChange={(e) => setForm((f) => ({ ...f, commodityId: e.target.value }))}>
                {commodities.length === 0 && <option value="">No active commodities</option>}
                {commodities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <label className="agri-form-label">Program Name</label>
              <input required className="form-control mb-3" value={form.program} onChange={(e) => setForm((f) => ({ ...f, program: e.target.value }))} placeholder="e.g. RCEF Seed Distribution" />

              <label className="agri-form-label">Venue</label>
              <input required className="form-control mb-3" value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} placeholder="e.g. Barangay Hall" />

              <div className="row g-3 mb-3">
                <div className="col-6">
                  <label className="agri-form-label">Beneficiaries</label>
                  <input required type="number" min="0" className="form-control" value={form.beneficiaries} onChange={(e) => setForm((f) => ({ ...f, beneficiaries: e.target.value }))} />
                </div>
                <div className="col-6">
                  <label className="agri-form-label">Quantity (kg)</label>
                  <input required type="number" min="0" className="form-control" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Distribution"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

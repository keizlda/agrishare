import { useMemo, useState } from "react";
import { Clock, Eye, Filter, Search, ShieldCheck, Users } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { listFarmers, setFarmerValidation } from "../lib/api/farmers.js";

const PAGE_SIZE = 5;

export default function Validation() {
  const { data: farmers, setData: setFarmers, loading, error: loadError } = useSupabaseList(listFarmers);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [eligibility, setEligibility] = useState("Eligible");
  const [validationStatusChoice, setValidationStatusChoice] = useState("Validated");
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");

  const pendingList = useMemo(
    () => farmers.filter((f) => f.validationStatus !== "Validated"),
    [farmers],
  );

  const filtered = useMemo(() => {
    if (!search) return pendingList;
    const q = search.toLowerCase();
    return pendingList.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(q) || f.rsbsaNo.includes(search));
  }, [pendingList, search]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);

  const selected = farmers.find((f) => f.id === selectedId) ?? null;

  const validatedCount = farmers.filter((f) => f.validationStatus === "Validated").length;
  const pendingCount = farmers.filter((f) => f.validationStatus === "Pending").length;
  const notValidatedCount = farmers.filter((f) => f.validationStatus === "Not Validated").length;

  async function applyDecision(status) {
    if (!selected) return;
    setActionError("");
    try {
      await setFarmerValidation(selected.id, status);
      setFarmers((prev) => prev.map((f) => (f.id === selected.id ? { ...f, validationStatus: status } : f)));
      setRemarks("");
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={ShieldCheck} label="Validated" value={validatedCount} sub={`${Math.round((validatedCount / (farmers.length || 1)) * 100)}% of total farmers`} color="green" />
        <StatCard icon={Clock} label="Pending Validation" value={pendingCount} sub={`${Math.round((pendingCount / (farmers.length || 1)) * 100)}% of total farmers`} color="orange" />
        <StatCard icon={Users} label="For Review" value={notValidatedCount} sub={`${Math.round((notValidatedCount / (farmers.length || 1)) * 100)}% of total farmers`} color="purple" />
      </OverviewDrawer>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1.6fr 1fr" : "1fr", gap: 16 }}>
        <div className="agri-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
              <input className="form-control" placeholder="Search farmer" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button className="agri-icon-btn"><Filter size={16} /></button>
          </div>

          <div className="agri-table-wrap">
            <table className="agri-table">
              <thead>
                <tr><th>RSBSA No.</th><th>Full Name</th><th>Barangay</th><th>Commodity</th><th>Date Registered</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {pageItems.map((f) => (
                  <tr key={f.id} className={f.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(f.id)}>
                    <td>{f.rsbsaNo}</td>
                    <td>{f.firstName} {f.lastName}</td>
                    <td>{f.barangay}</td>
                    <td>{f.commodity}</td>
                    <td>{f.dateRegistered}</td>
                    <td><Pill status={f.validationStatus} /></td>
                    <td><Eye size={15} color="#8b978f" /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={7} className="agri-muted text-center py-4">Loading farmers…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="agri-muted text-center py-4">No farmers pending validation.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>

        {selected && (
          <div className="agri-card" style={{ padding: 18, alignSelf: "flex-start" }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Farmer Details</div>
              <Pill status={selected.validationStatus} />
            </div>

            <div className="agri-detail-row">
              <div>
                <div className="agri-detail-label">Full Name</div>
                <div style={{ fontWeight: 600 }}>{selected.firstName} {selected.lastName}</div>
              </div>
            </div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">RSBSA Number</div>{selected.rsbsaNo}</div></div>

            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 16, marginBottom: 4 }}>Personal Information</div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Date of Birth</div>{selected.birthDate}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Gender</div>{selected.sex}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Contact Number</div>{selected.contactNo}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Address</div>Brgy. {selected.barangay}, Labangan, Zamboanga del Sur</div></div>

            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 16, marginBottom: 4 }}>Farming Information</div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity</div>{selected.commodity}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Farm Size</div>{selected.farmSize} ha</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Farm Location</div>Brgy. {selected.farmLocation}</div></div>

            <div style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 16, marginBottom: 8 }}>Validation Form</div>
            <div className="row g-2">
              <div className="col-6">
                <label className="agri-form-label">Eligibility Status</label>
                <select className="form-select mb-3" value={eligibility} onChange={(e) => setEligibility(e.target.value)}>
                  <option>Eligible</option>
                  <option>Not Eligible</option>
                </select>
              </div>
              <div className="col-6">
                <label className="agri-form-label">Validation Status</label>
                <select className="form-select mb-3" value={validationStatusChoice} onChange={(e) => setValidationStatusChoice(e.target.value)}>
                  <option>Validated</option>
                  <option>Pending</option>
                  <option>Not Validated</option>
                </select>
              </div>
            </div>

            <label className="agri-form-label">Remarks (Optional)</label>
            <textarea className="form-control mb-3" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline-secondary flex-fill" onClick={() => applyDecision("Pending")}>For Review</button>
              <button className="btn btn-outline-danger flex-fill" onClick={() => applyDecision("Not Validated")}>Reject</button>
              <button className="btn btn-agri-primary flex-fill" onClick={() => applyDecision(validationStatusChoice)}>Validate</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

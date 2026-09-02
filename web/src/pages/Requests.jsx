import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Filter, Search, Send, ShieldAlert, XCircle } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import Toast from "../components/ui/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { computeRequestStats } from "../data/mockData.js";
import { listRequests, updateRequestStatus } from "../lib/api/requests.js";

export default function Requests() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listRequests);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!selectedId && requests.length > 0) setSelectedId(requests[0].id);
  }, [requests, selectedId]);

  const stats = computeRequestStats(requests);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const matchesSearch = !search || r.farmerName.toLowerCase().includes(search.toLowerCase()) || r.commodity.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "All" || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [requests, search, statusFilter]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  async function updateRequest(id, patch) {
    setActionError("");
    setSaving(true);
    try {
      const updated = await updateRequestStatus(id, patch);
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setRemarks("");
      setToast({ tone: "success", message: `Request ${patch.status.toLowerCase()}.` });
    } catch (err) {
      setActionError(err.message);
      setToast({ tone: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  function handleForward() {
    if (!selected) return;
    updateRequest(selected.id, { status: "Forwarded", faRemarks: remarks || selected.faRemarks });
  }

  function handleFAReject() {
    if (!selected) return;
    updateRequest(selected.id, { status: "Rejected", faRemarks: remarks || selected.faRemarks });
  }

  function handleApprove() {
    if (!selected) return;
    updateRequest(selected.id, { status: "Approved", maoRemarks: remarks || selected.maoRemarks });
  }

  function handleMAOReject() {
    if (!selected) return;
    updateRequest(selected.id, { status: "Rejected", maoRemarks: remarks || selected.maoRemarks });
  }

  // FA President acts on Pending requests (forward or reject at intake);
  // MAO Admin acts once a request has been Forwarded. Anything Approved or
  // Rejected is final and read-only for both roles.
  const canFAAct = !isMAO && selected?.status === "Pending";
  const canMAOAct = isMAO && selected?.status === "Forwarded";

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={Clock} label="Pending" value={stats.pending} sub="Awaiting FA review" color="orange" />
        <StatCard icon={Send} label="Forwarded" value={stats.forwarded} sub="Awaiting MAO decision" color="purple" />
        <StatCard icon={CheckCircle2} label="Approved" value={stats.approved} sub="All time" color="green" />
        <StatCard icon={XCircle} label="Rejected" value={stats.rejected} sub="All time" color="red" />
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
              <input className="form-control" placeholder="Search farmer or commodity" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              <option value="Pending">Pending</option>
              <option value="Forwarded">Forwarded</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
            <button
              type="button"
              className="agri-icon-btn"
              title="Reset filters"
              aria-label="Reset filters"
              onClick={() => { setSearch(""); setStatusFilter("All"); }}
            >
              <Filter size={16} />
            </button>
          </div>

          <div className="agri-table-wrap">
            <table className="agri-table">
              <thead>
                <tr><th>Request ID</th><th>Farmer</th><th>Commodity</th><th>Quantity</th><th>Date Requested</th><th>Status</th></tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={r.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(r.id)}>
                    <td>{r.id}</td>
                    <td>{r.farmerName}</td>
                    <td>{r.commodity}</td>
                    <td>{r.quantity.toLocaleString()} {r.unit}</td>
                    <td>{r.requestDate}</td>
                    <td><Pill status={r.status} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Loading requests…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">No requests match your search/filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="agri-card" style={{ padding: 18, alignSelf: "flex-start" }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Request Details</div>
              <Pill status={selected.status} />
            </div>

            <div className="agri-detail-row"><div><div className="agri-detail-label">Farmer</div>{selected.farmerName}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">RSBSA Number</div>{selected.rsbsaNo}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay</div>{selected.barangay}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity Requested</div>{selected.commodity}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity</div>{selected.quantity.toLocaleString()} {selected.unit}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Date Requested</div>{selected.requestDate}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Reason</div>{selected.reason}</div></div>

            {selected.faRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">FA President Remarks</div>{selected.faRemarks}</div></div>
            )}
            {selected.maoRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">MAO Remarks</div>{selected.maoRemarks}</div></div>
            )}

            {(canFAAct || canMAOAct) && (
              <div style={{ marginTop: 16 }}>
                <label className="agri-form-label">Remarks</label>
                <textarea className="form-control mb-3" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add remarks before making a decision" />

                {canFAAct && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-outline-danger flex-fill" onClick={handleFAReject} disabled={saving}>Reject</button>
                    <button className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={handleForward} disabled={saving}>
                      <Send size={14} /> Forward to MAO
                    </button>
                  </div>
                )}
                {canMAOAct && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-outline-danger flex-fill" onClick={handleMAOReject} disabled={saving}>Reject</button>
                    <button className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={handleApprove} disabled={saving}>
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                )}
              </div>
            )}

            {!isMAO && selected.status !== "Pending" && (
              <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, padding: "8px 12px" }}>
                <ShieldAlert size={13} /> This request has already been reviewed.
              </div>
            )}
            {isMAO && selected.status === "Pending" && (
              <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, padding: "8px 12px" }}>
                <ShieldAlert size={13} /> Awaiting FA President review before MAO action.
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

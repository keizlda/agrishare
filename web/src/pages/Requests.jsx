import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, History, Inbox, Search, Send, ShieldAlert } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import Toast from "../components/ui/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { listRequests, listRequestsForAdminReview, faReviewRequest, adminReviewRequest } from "../lib/api/requests.js";

// status is the raw four-value lifecycle (Pending/Forwarded/Approved/
// Rejected) — Pill's color lookup keys off that. The label shown to the
// user is friendlier and, for Rejected specifically, distinguishes which
// stage actually rejected it (FA directly vs. Admin overruling an
// FA-approved request) using rejectedBy from the API layer.
function reviewLabel(r) {
  if (r.status === "Forwarded") return "FA Approved";
  if (r.status === "Rejected") return r.rejectedBy === "admin" ? "Rejected by Admin" : "FA Rejected";
  return r.status;
}

export default function Requests() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  return isMAO ? <AdminRequestsView /> : <FARequestsView currentUserId={user?.id} />;
}

// ═══════════════════════════════════════════════════════════════════════
// FA President — Level 1. Full farmer detail; acts on Pending requests.
// ═══════════════════════════════════════════════════════════════════════
const FA_TABS = [
  { key: "pending", label: "Pending Review" },
  { key: "mine", label: "My Decisions" },
  { key: "awaiting", label: "Awaiting Admin" },
  { key: "final", label: "Final Status" },
];

function faTabRows(requests, key, currentUserId) {
  switch (key) {
    case "pending":
      return requests.filter((r) => r.status === "Pending");
    case "mine":
      return requests.filter((r) => r.reviewedByFa === currentUserId);
    case "awaiting":
      return requests.filter((r) => r.status === "Forwarded");
    case "final":
      // Reached a final ADMIN decision specifically — excludes requests FA
      // rejected directly, which are final too but never reached Admin
      // (those show up under "My Decisions" instead).
      return requests.filter((r) => (r.status === "Approved" || r.status === "Rejected") && r.adminDecisionAt);
    default:
      return requests;
  }
}

function FARequestsView({ currentUserId }) {
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listRequests);
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const tabbed = useMemo(() => faTabRows(requests, tab, currentUserId), [requests, tab, currentUserId]);

  const filtered = useMemo(() => {
    if (!search) return tabbed;
    const q = search.toLowerCase();
    return tabbed.filter((r) => r.farmerName.toLowerCase().includes(q) || r.commodity.toLowerCase().includes(q));
  }, [tabbed, search]);

  useEffect(() => {
    if (!filtered.some((r) => r.id === selectedId)) setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const canAct = selected?.status === "Pending";

  async function act(decision) {
    if (!selected) return;
    setActionError("");
    setSaving(true);
    try {
      const updated = await faReviewRequest(selected.id, { decision, notes: remarks || undefined });
      setRequests((prev) => prev.map((r) => (r.id === selected.id ? updated : r)));
      setRemarks("");
      setToast({ tone: "success", message: decision === "approve" ? "Approved and forwarded to Admin." : "Request rejected." });
    } catch (err) {
      setActionError(err.message);
      setToast({ tone: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="agri-tabs">
        {FA_TABS.map((t) => (
          <button key={t.key} type="button" className={`agri-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="agri-tab-count">{faTabRows(requests, t.key, currentUserId).length}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1.6fr 1fr" : "1fr", gap: 16 }}>
        <div className="agri-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div style={{ position: "relative", marginBottom: 14 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
            <input className="form-control" placeholder="Search farmer or commodity" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)} />
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
                    <td><Pill status={r.status}>{reviewLabel(r)}</Pill></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Loading requests…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Nothing in this tab.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="agri-card" style={{ padding: 18, alignSelf: "flex-start" }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Request Details</div>
              <Pill status={selected.status}>{reviewLabel(selected)}</Pill>
            </div>

            <div className="agri-detail-row"><div><div className="agri-detail-label">Farmer</div>{selected.farmerName}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">RSBSA Number</div>{selected.rsbsaNo}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay</div>{selected.barangay}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity Requested</div>{selected.commodity}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity</div>{selected.quantity.toLocaleString()} {selected.unit}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Date Requested</div>{selected.requestDate}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Reason</div>{selected.reason}</div></div>

            {selected.faRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Your Remarks</div>{selected.faRemarks}</div></div>
            )}
            {selected.maoRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Admin's Remarks</div>{selected.maoRemarks}</div></div>
            )}
            {selected.adminDecisionAt && (
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Admin Decision</div>
                  {selected.status} on {selected.adminDecisionAt.slice(0, 10)}
                </div>
              </div>
            )}

            {canAct && (
              <div style={{ marginTop: 16 }}>
                <label className="agri-form-label">Notes (optional)</label>
                <textarea className="form-control mb-3" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add a note before deciding" />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-outline-danger flex-fill" onClick={() => act("reject")} disabled={saving}>Reject</button>
                  <button className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => act("approve")} disabled={saving}>
                    <Send size={14} /> Approve &amp; Forward
                  </button>
                </div>
              </div>
            )}

            {!canAct && (
              <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, padding: "8px 12px" }}>
                <ShieldAlert size={13} />
                {selected.status === "Forwarded" ? "Forwarded to Admin — awaiting final decision." : "This request has already been decided."}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAO Admin — Level 2. Only ever sees requests the FA President already
// approved, and never sees who the farmer is — reviews the FA President's
// judgment on its own merits. Sourced from requests_for_admin_review,
// a view with no farmer column at all (see the migration).
// ═══════════════════════════════════════════════════════════════════════
const ADMIN_TABS = [
  { key: "awaiting", label: "Awaiting Admin Review" },
  { key: "history", label: "Decision History" },
];

function adminTabRows(requests, key) {
  return key === "awaiting"
    ? requests.filter((r) => r.status === "Forwarded")
    : requests.filter((r) => r.status === "Approved" || r.status === "Rejected");
}

function AdminRequestsView() {
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listRequestsForAdminReview);
  const [tab, setTab] = useState("awaiting");
  const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const tabbed = useMemo(() => adminTabRows(requests, tab), [requests, tab]);

  useEffect(() => {
    if (!tabbed.some((r) => r.id === selectedId)) setSelectedId(tabbed[0]?.id ?? null);
  }, [tabbed, selectedId]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const canAct = selected?.status === "Forwarded";

  async function act(decision) {
    if (!selected) return;
    setActionError("");
    setSaving(true);
    try {
      // adminReviewRequest returns the full base-table row shape (it
      // updates public.requests directly); this view only renders a
      // handful of those fields, so patch just those rather than
      // replacing the row with a shape this list doesn't expect.
      const updated = await adminReviewRequest(selected.id, { decision, notes: remarks || undefined });
      setRequests((prev) =>
        prev.map((r) =>
          r.id === selected.id
            ? { ...r, status: updated.status, maoRemarks: updated.maoRemarks, adminDecisionAt: updated.adminDecisionAt }
            : r
        )
      );
      setRemarks("");
      setToast({ tone: "success", message: `Request ${decision === "approve" ? "approved" : "rejected"}.` });
    } catch (err) {
      setActionError(err.message);
      setToast({ tone: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="agri-tabs">
        {ADMIN_TABS.map((t) => (
          <button key={t.key} type="button" className={`agri-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.key === "history" ? <History size={13} /> : <Inbox size={13} />}
            {t.label}
            <span className="agri-tab-count">{adminTabRows(requests, t.key).length}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1.6fr 1fr" : "1fr", gap: 16 }}>
        <div className="agri-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div className="agri-table-wrap">
            <table className="agri-table">
              <thead>
                <tr><th>Request ID</th><th>FA President</th><th>Commodity</th><th>Quantity</th><th>FA Decision Date</th><th>Status</th></tr>
              </thead>
              <tbody>
                {tabbed.map((r) => (
                  <tr key={r.id} className={r.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(r.id)}>
                    <td>{r.id}</td>
                    <td>{r.faPresidentName}</td>
                    <td>{r.commodity}</td>
                    <td>{r.quantity.toLocaleString()} {r.unit}</td>
                    <td>{r.faDecisionAt?.slice(0, 10) ?? "—"}</td>
                    <td><Pill status={r.status}>{reviewLabel(r)}</Pill></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Loading requests…</td></tr>
                )}
                {!loading && tabbed.length === 0 && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Nothing here yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="agri-card" style={{ padding: 18, alignSelf: "flex-start" }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Request Details</div>
              <Pill status={selected.status}>{reviewLabel(selected)}</Pill>
            </div>

            <div className="agri-detail-row"><div><div className="agri-detail-label">FA President</div>{selected.faPresidentName}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity</div>{selected.commodity}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity</div>{selected.quantity.toLocaleString()} {selected.unit}</div></div>
            <div className="agri-detail-row">
              <div>
                <div className="agri-detail-label">FA Decision</div>
                Approved on {selected.faDecisionAt?.slice(0, 10) ?? "—"}
              </div>
            </div>
            {selected.faRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">FA President's Remarks</div>{selected.faRemarks}</div></div>
            )}
            {selected.maoRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Your Remarks</div>{selected.maoRemarks}</div></div>
            )}

            {canAct && (
              <div style={{ marginTop: 16 }}>
                <label className="agri-form-label">Notes (optional)</label>
                <textarea className="form-control mb-3" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add a reason for your decision" />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-outline-danger flex-fill" onClick={() => act("reject")} disabled={saving}>Reject</button>
                  <button className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => act("approve")} disabled={saving}>
                    <CheckCircle2 size={14} /> Approve
                  </button>
                </div>
              </div>
            )}
            {!canAct && (
              <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, padding: "8px 12px" }}>
                <ShieldAlert size={13} /> This request has already been decided.
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

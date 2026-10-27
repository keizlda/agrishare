import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, History, Inbox, Search, Send, ShieldAlert } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import FarmerAvatar from "../components/ui/FarmerAvatar.jsx";
import Toast from "../components/ui/Toast.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { listRequests, listRequestsForAdminReview, faReviewRequest, adminReviewRequest } from "../lib/api/requests.js";
import { formatDate } from "../lib/dates.js";
import { friendlyError } from "../lib/friendlyError.js";
import { rowLinkProps } from "../lib/rowLink.js";

// status is the raw four-value lifecycle (Pending/Forwarded/Approved/
// Rejected). The Farmers' Association President endorses (or doesn't); only
// the MAO approves or rejects. So the label shown is:
//   Pending -> Endorsed -> Approved or Rejected, or Not endorsed when the
//   Farmers' Association President turned it down (rejectedBy "fa").
// Pill colors key off this label (Pill.jsx).
function reviewLabel(r) {
  if (r.status === "Forwarded") return "Endorsed";
  if (r.status === "Rejected" && r.rejectedBy === "fa") return "Not endorsed";
  return r.status;
}

export default function Requests() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  return isMAO ? <AdminRequestsView /> : <FARequestsView currentUserId={user?.id} />;
}

// ═══════════════════════════════════════════════════════════════════════
// FA President — Level 1. Full farmer detail; endorses (or not) Pending
// requests.
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
      // didn't endorse, which are final too but never reached Admin
      // (those show up under "My Decisions" instead).
      return requests.filter((r) => (r.status === "Approved" || r.status === "Rejected") && r.adminDecisionAt);
    default:
      return requests;
  }
}

function FARequestsView({ currentUserId }) {
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listRequests);
  // ?tab= preselects a tab (the Dashboard's "requests to review" chip).
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (FA_TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "pending"));
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

  // Rows per page = however many fit in the full-height table area (min 5).
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  useCardLabels(tableRef);
  const detailRef = useRef(null);
  const revealDetail = useRevealDetail(detailRef);
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, pageSize);

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
      setToast({ tone: "success", message: decision === "approve" ? "Endorsed and sent to the MAO for approval." : "Request not endorsed." });
    } catch (err) {
      const message = friendlyError(err, "Couldn't save this decision. Please try again.");
      setActionError(message);
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-fill-root">
      <div className="agri-tabs">
        {FA_TABS.map((t) => (
          <button key={t.key} type="button" className={`agri-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="agri-tab-count">{faTabRows(requests, t.key, currentUserId).length}</span>
          </button>
        ))}
      </div>

      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div style={{ position: "relative", marginBottom: 14 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--agri-icon-muted)" }} />
            <input className="form-control" placeholder="Search farmer or commodity" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead>
                <tr><th>Farmer</th><th>Commodity</th><th>Quantity</th><th>Date Requested</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} {...rowLinkProps(() => { setSelectedId(r.id); revealDetail(); }, { selected: r.id === selectedId })}>
                    <td><span className="agri-row-title">{r.farmerName}</span></td>
                    <td>{r.commodity}</td>
                    <td>{r.quantity.toLocaleString()} {r.unit}</td>
                    <td>{formatDate(r.requestDate)}</td>
                    <td><Pill status={reviewLabel(r)} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={5} className="agri-muted text-center py-4">Loading requests…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={5} className="agri-muted text-center py-4">Nothing in this tab.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["request", "requests"]} />
        </div>

        {selected && (
          <div ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Request Details</div>
              <Pill status={reviewLabel(selected)} />
            </div>

            <div className="agri-detail-body">
            <div className="agri-detail-row"><div><div className="agri-detail-label">Farmer</div>{selected.farmerName}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">RSBSA Number</div>{selected.rsbsaNo}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Barangay</div>{selected.barangay}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity Requested</div>{selected.commodity}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity</div>{selected.quantity.toLocaleString()} {selected.unit}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Date Requested</div>{formatDate(selected.requestDate)}</div></div>
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
                  {selected.status} on {formatDate(selected.adminDecisionAt)}
                </div>
              </div>
            )}
            </div>

            <div className="agri-detail-actions">
            {canAct && (
              <div>
                <label className="agri-form-label">Notes (optional)</label>
                <textarea className="form-control mb-3" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add a note before deciding" />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-outline-danger flex-fill" onClick={() => act("reject")} disabled={saving}>Reject</button>
                  <button className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => act("approve")} disabled={saving}>
                    <Send size={14} /> Endorse
                  </button>
                </div>
              </div>
            )}

            {!canAct && (
              <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                <ShieldAlert size={13} />
                {selected.status === "Forwarded" ? "Endorsed — waiting for the MAO's decision." : "This request has already been decided."}
              </div>
            )}
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAO Admin — Level 2. Sees every request past the Farmers' Association
// President's review, with the farmer who made it, and approves or rejects
// the endorsed ones.
// ═══════════════════════════════════════════════════════════════════════
const ADMIN_TABS = [
  { key: "awaiting", label: "Awaiting Admin Review" },
  { key: "history", label: "Decision History" },
];

// History: the final status — Approved, Rejected, or Not endorsed.
function adminTabRows(requests, key) {
  return key === "awaiting"
    ? requests.filter((r) => r.status === "Forwarded")
    : requests.filter((r) => r.status === "Approved" || r.status === "Rejected");
}

function AdminRequestsView() {
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listRequestsForAdminReview);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (ADMIN_TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "awaiting"));
  const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const tabbed = useMemo(() => adminTabRows(requests, tab), [requests, tab]);

  // Rows per page = however many fit in the full-height table area (min 5).
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: tabbed.length > 0 });
  useCardLabels(tableRef);
  const detailRef = useRef(null);
  const revealDetail = useRevealDetail(detailRef);
  const { page, setPage, totalPages, pageItems } = usePagination(tabbed, pageSize);

  useEffect(() => {
    if (!tabbed.some((r) => r.id === selectedId)) setSelectedId(tabbed[0]?.id ?? null);
  }, [tabbed, selectedId]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const canAct = selected?.status === "Forwarded";
  const notEndorsed = selected?.rejectedBy === "fa";

  async function act(decision) {
    if (!selected) return;
    setActionError("");
    setSaving(true);
    try {
      const updated = await adminReviewRequest(selected.id, { decision, notes: remarks || undefined });
      setRequests((prev) => prev.map((r) => (r.id === selected.id ? updated : r)));
      setRemarks("");
      setToast({ tone: "success", message: `Request ${decision === "approve" ? "approved" : "rejected"}.` });
    } catch (err) {
      const message = friendlyError(err, "Couldn't save this decision. Please try again.");
      setActionError(message);
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-fill-root">
      <div className="agri-tabs">
        {ADMIN_TABS.map((t) => (
          <button key={t.key} type="button" className={`agri-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.key === "history" ? <History size={13} /> : <Inbox size={13} />}
            {t.label}
            <span className="agri-tab-count">{adminTabRows(requests, t.key).length}</span>
          </button>
        ))}
      </div>

      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {(loadError || actionError) && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError || actionError}
            </div>
          )}
          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead>
                <tr><th>Farmer</th><th>Commodity</th><th>Quantity</th><th>Endorsed On</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} {...rowLinkProps(() => { setSelectedId(r.id); revealDetail(); }, { selected: r.id === selectedId })}>
                    <td>
                      <span className="agri-farmer-cell">
                        <FarmerAvatar url={r.avatarUrl} firstName={r.farmerFirstName} lastName={r.farmerLastName} size={28} />
                        <span className="agri-row-title">{r.farmerName}</span>
                      </span>
                    </td>
                    <td>{r.commodity}</td>
                    <td>{r.quantity.toLocaleString()} {r.unit}</td>
                    <td>{formatDate(r.forwardedToAdminAt)}</td>
                    <td><Pill status={reviewLabel(r)} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={5} className="agri-muted text-center py-4">Loading requests…</td></tr>
                )}
                {!loading && tabbed.length === 0 && (
                  <tr><td colSpan={5} className="agri-muted text-center py-4">Nothing here yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <TableFooter page={page} pageSize={pageSize} total={tabbed.length} totalPages={totalPages} onPageChange={setPage} noun={["request", "requests"]} />
        </div>

        {selected && (
          <div ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Request Details</div>
              <Pill status={reviewLabel(selected)} />
            </div>

            <div className="agri-detail-body">
            <div className="agri-detail-row">
              <div>
                <div className="agri-detail-label">Farmer</div>
                {selected.farmerName}
                <div className="agri-muted" style={{ fontSize: "0.78rem" }}>RSBSA No. {selected.rsbsaNo || "—"}</div>
              </div>
            </div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity</div>{selected.commodity}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity</div>{selected.quantity.toLocaleString()} {selected.unit}</div></div>
            <div className="agri-detail-row"><div><div className="agri-detail-label">Requested On</div>{formatDate(selected.requestDate)}</div></div>
            <div className="agri-detail-row">
              <div>
                <div className="agri-detail-label">{notEndorsed ? "Not Endorsed By" : "Endorsed By"}</div>
                {selected.faPresidentName} on {formatDate(notEndorsed ? selected.faDecisionAt : selected.forwardedToAdminAt ?? selected.faDecisionAt)}
              </div>
            </div>
            <div className="agri-detail-row">
              <div>
                <div className="agri-detail-label">{notEndorsed ? "Remarks" : "Endorsement Remarks"}</div>
                {selected.faRemarks || <span className="agri-muted">None</span>}
              </div>
            </div>
            {selected.maoRemarks && (
              <div className="agri-detail-row"><div><div className="agri-detail-label">Your Remarks</div>{selected.maoRemarks}</div></div>
            )}
            </div>

            <div className="agri-detail-actions">
            {canAct && (
              <div>
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
              <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                <ShieldAlert size={13} />
                {notEndorsed ? "Not endorsed by the Farmers' Association President, so it never reached the MAO." : "This request has already been decided."}
              </div>
            )}
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

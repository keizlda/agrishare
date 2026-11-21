import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Inbox, Search, Send, ShieldAlert, Users } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import FarmerAvatar from "../components/ui/FarmerAvatar.jsx";
import Toast from "../components/ui/Toast.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import RequestTimeline from "../components/requests/RequestTimeline.jsx";
import AssociationRequestsView from "../components/requests/AssociationRequestsView.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { listRequests, faReviewRequest, adminReviewRequest } from "../lib/api/requests.js";
import { formatHectares } from "../lib/allocation.js";
import { formatDate } from "../lib/dates.js";
import { formatQuantity } from "../lib/quantity.js";
import { friendlyError } from "../lib/friendlyError.js";
import { rowLinkProps } from "../lib/rowLink.js";
import { reviewLabel } from "../lib/requestStatus.js";

// Two kinds of requests, one tab each: farmers' commodity requests, and the
// Farmers' Association President's requests to the MAO for machinery,
// projects or other support. ?section=association opens the second (links
// from notifications).
const SECTIONS = [
  { key: "farmer", label: "Farmer Requests", icon: Inbox },
  { key: "association", label: "Association Requests", icon: Users },
];
const sectionFrom = (params) => (params.get("section") === "association" ? "association" : "farmer");

export default function Requests() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const [searchParams, setSearchParams] = useSearchParams();
  const [section, setSection] = useState(() => sectionFrom(searchParams));

  // A notification link (?section=…) clicked while already on this page.
  useEffect(() => {
    setSection(sectionFrom(searchParams));
  }, [searchParams]);

  function chooseSection(key) {
    setSection(key);
    setSearchParams(key === "association" ? { section: key } : {}, { replace: true });
  }

  return (
    <div className="agri-fill-root">
      <div className="agri-tabs" role="tablist" aria-label="Request type">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={section === key} className={`agri-tab${section === key ? " active" : ""}`} onClick={() => chooseSection(key)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {section === "association" ? <AssociationRequestsView isMAO={isMAO} /> : <FarmerRequestsView isMAO={isMAO} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Farmer Requests — the same list for both roles: every request in every
// status, from the moment the farmer submits it. Each role acts only at its
// own step (the database enforces this too):
//   Farmers' Association President: endorses (or doesn't) Pending requests.
//   MAO Admin: approves or rejects Endorsed requests; Pending ones are
//   read-only until the Farmers' Association President has endorsed them.
// ═══════════════════════════════════════════════════════════════════════
const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "endorsed", label: "Endorsed" },
  { key: "not-endorsed", label: "Not endorsed" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];
const statusKey = (r) => reviewLabel(r).toLowerCase().replace(" ", "-");
// Links from before the status filters (?tab=…, e.g. older Dashboard links).
const LEGACY_TABS = { pending: "pending", awaiting: "endorsed", mine: "all", final: "all", history: "all" };
function initialFilter(params) {
  const status = params.get("status");
  if (STATUS_FILTERS.some((f) => f.key === status)) return status;
  return LEGACY_TABS[params.get("tab")] ?? "all";
}

// Name, RSBSA number (typed with or without dashes) or commodity.
function matchesSearch(r, term) {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    r.farmerName.toLowerCase().includes(q) ||
    r.commodity.toLowerCase().includes(q) ||
    r.rsbsaNo.toLowerCase().includes(q) ||
    (digits.length >= 3 && r.rsbsaNo.replace(/\D/g, "").includes(digits))
  );
}

const MAX_NOTES_LENGTH = 500;

function FarmerRequestsView({ isMAO }) {
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listRequests);
  // ?status= preselects a filter (the Dashboard's "requests to review" chip).
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => initialFilter(searchParams));
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [toast, setToast] = useState(null);

  const searched = useMemo(() => requests.filter((r) => matchesSearch(r, search)), [requests, search]);
  const filtered = useMemo(() => (filter === "all" ? searched : searched.filter((r) => statusKey(r) === filter)), [searched, filter]);
  const counts = useMemo(() => {
    const c = { all: searched.length };
    for (const r of searched) c[statusKey(r)] = (c[statusKey(r)] ?? 0) + 1;
    return c;
  }, [searched]);

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
  useEffect(() => {
    setRemarks("");
    setActionError("");
  }, [selectedId]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const label = selected ? reviewLabel(selected) : "";
  // Each role's own step: the FA President decides Pending requests, the
  // MAO Admin decides Endorsed ones.
  const canAct = !!selected && (isMAO ? selected.status === "Forwarded" : selected.status === "Pending");

  async function act(decision) {
    if (!selected || savingRef.current) return;
    if (remarks.length > MAX_NOTES_LENGTH) {
      setActionError(`Keep the notes to ${MAX_NOTES_LENGTH} characters or fewer.`);
      return;
    }
    savingRef.current = true;
    setActionError("");
    setSaving(true);
    try {
      const notes = remarks.trim() || undefined;
      const updated = isMAO
        ? await adminReviewRequest(selected.id, { decision, notes })
        : await faReviewRequest(selected.id, { decision, notes });
      setRequests((prev) => prev.map((r) => (r.id === selected.id ? updated : r)));
      setRemarks("");
      setToast({
        tone: "success",
        message: isMAO
          ? `Request ${decision === "approve" ? "approved" : "rejected"}.`
          : decision === "approve"
            ? "Endorsed and sent to the MAO for approval."
            : "Request not endorsed.",
      });
    } catch (err) {
      const message = friendlyError(err, "Couldn't save this decision. Please try again.");
      setActionError(message);
      setToast({ tone: "error", message });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Why there's nothing to do on the selected request (for this role).
  function readOnlyNote() {
    if (selected.status === "Pending") return "Waiting for the Farmers' Association President's endorsement.";
    if (selected.status === "Forwarded") return "Endorsed — waiting for the MAO's decision.";
    if (selected.rejectedBy === "fa") return "Not endorsed by the Farmers' Association President, so it never reached the MAO.";
    return "This request has already been decided.";
  }

  return (
    <>
      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {loadError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {loadError}
            </div>
          )}
          <div className="agri-toolbar">
            <div className="agri-toolbar-search">
              <Search size={15} />
              <input className="form-control" placeholder="Search farmer, RSBSA no. or commodity" aria-label="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="agri-filter-chips" role="tablist" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`agri-filter-chip${filter === f.key ? " active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="agri-filter-chip-count">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead>
                <tr><th>Farmer</th><th>Commodity</th><th>Quantity</th><th>Date Requested</th><th>Status</th></tr>
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
                    <td>{formatQuantity(r.quantity, r.unit)}</td>
                    <td>{formatDate(r.requestDate)}</td>
                    <td><Pill status={reviewLabel(r)} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={5} className="agri-muted text-center py-4">Loading requests…</td></tr>
                )}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <EmptyState
                icon={Inbox}
                title="No requests found"
                hint={search ? "Try a different name, RSBSA number or commodity." : filter === "all" ? "Farmers' requests appear here as soon as they're submitted." : "No requests with this status."}
              />
            )}
          </div>
          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["request", "requests"]} />
        </div>

        {selected && (
          <div ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Request Details</div>
              <Pill status={label} />
            </div>

            <div className="agri-detail-body">
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Farmer</div>
                  {selected.farmerName}
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>RSBSA No. {selected.rsbsaNo || "—"}</div>
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>{[selected.sitioPurok, selected.barangay].filter(Boolean).join(", ")}</div>
                </div>
              </div>
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Farm Size</div>
                  {formatHectares(selected.farmSize)}
                  {selected.cropType && <span className="agri-muted"> · {selected.cropType}</span>}
                </div>
              </div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity</div>{selected.commodity}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity Requested</div>{formatQuantity(selected.quantity, selected.unit)}</div></div>
              {selected.suggestedQuantity !== null && (
                <div className="agri-detail-row">
                  <div>
                    <div className="agri-detail-label">Suggested for Farm Size</div>
                    {formatQuantity(selected.suggestedQuantity, selected.unit)}
                    <div className="agri-muted" style={{ fontSize: "0.78rem" }}>
                      {formatHectares(selected.farmSize)} × {selected.allocationPerHectare.toLocaleString()} {selected.unit}/ha
                      {selected.suggestedQuantity !== selected.quantity && " · differs from the request"}
                    </div>
                  </div>
                </div>
              )}
              <div className="agri-detail-row"><div><div className="agri-detail-label">Reason</div>{selected.reason || <span className="agri-muted">None given</span>}</div></div>

              <div className="agri-detail-section-title">Timeline</div>
              <RequestTimeline request={selected} />
            </div>

            <div className="agri-detail-actions">
              {canAct ? (
                <div>
                  {actionError && (
                    <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{actionError}</div>
                  )}
                  <label className="agri-form-label" htmlFor="request-notes">Notes (optional)</label>
                  <textarea
                    id="request-notes"
                    className="form-control mb-3"
                    rows={2}
                    maxLength={MAX_NOTES_LENGTH}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder={isMAO ? "Add a reason for your decision" : "Add a note before deciding"}
                    disabled={saving}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn btn-outline-danger flex-fill" onClick={() => act("reject")} disabled={saving}>Reject</button>
                    <button type="button" className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => act("approve")} disabled={saving}>
                      {isMAO ? <><CheckCircle2 size={14} /> Approve</> : <><Send size={14} /> Endorse</>}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                  <ShieldAlert size={13} style={{ flex: "none" }} />
                  {readOnlyNote()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </>
  );
}

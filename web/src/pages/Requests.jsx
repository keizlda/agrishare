import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Inbox, Plus, Search, Send, ShieldAlert, Users } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import FarmerAvatar from "../components/ui/FarmerAvatar.jsx";
import Toast from "../components/ui/Toast.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import RequestTimeline from "../components/requests/RequestTimeline.jsx";
import AssociationRequestsView from "../components/requests/AssociationRequestsView.jsx";
import FarmerRequestModal from "../components/requests/FarmerRequestModal.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import { listRequests, faRecommendRequest, adminReviewRequest } from "../lib/api/requests.js";
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
// status, from the moment it's submitted. A request goes straight to the
// MAO Admin (Pending → Approved / Rejected, a reason required to reject).
// The Farmers' Association President may add a remark or mark it
// "Recommended by Farmers' Association President" while it's Pending —
// never required. The database enforces who may do what.
// ═══════════════════════════════════════════════════════════════════════
const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];
const statusKey = (r) => reviewLabel(r).toLowerCase();
// Older links (?tab=… or ?status=endorsed) open the matching filter.
const LEGACY = { pending: "pending", awaiting: "pending", endorsed: "pending", "not-endorsed": "rejected", mine: "all", final: "all", history: "all" };
function initialFilter(params) {
  const status = params.get("status");
  if (STATUS_FILTERS.some((f) => f.key === status)) return status;
  return LEGACY[status] ?? LEGACY[params.get("tab")] ?? "all";
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
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => initialFilter(searchParams));
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const remarksRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [filing, setFiling] = useState(false);

  const searched = useMemo(() => requests.filter((r) => matchesSearch(r, search)), [requests, search]);
  const filtered = useMemo(() => (filter === "all" ? searched : searched.filter((r) => statusKey(r) === filter)), [searched, filter]);
  const counts = useMemo(() => {
    const c = { all: searched.length };
    for (const r of searched) c[statusKey(r)] = (c[statusKey(r)] ?? 0) + 1;
    return c;
  }, [searched]);

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
  const pending = selected?.status === "Pending";

  // The FA President's form starts from what's saved.
  useEffect(() => {
    setActionError("");
    setRemarks(!isMAO && selected ? selected.faRemarks : "");
    setRecommended(!!selected?.recommended);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function decide(decision) {
    if (!selected || savingRef.current) return;
    if (decision === "reject" && !remarks.trim()) {
      setActionError("Give a reason for rejecting this request.");
      remarksRef.current?.focus();
      return;
    }
    await save(() => adminReviewRequest(selected.id, { decision, notes: remarks }), decision === "approve" ? "Request approved. The farmer was notified." : "Request rejected. The farmer was notified.");
  }

  async function saveRecommendation() {
    if (!selected || savingRef.current) return;
    await save(() => faRecommendRequest(selected.id, { recommended, remarks }), recommended ? "Recommendation saved. The MAO can see it." : "Remark saved.");
  }

  async function save(fn, success) {
    if (remarks.length > MAX_NOTES_LENGTH) {
      setActionError(`Keep the remarks to ${MAX_NOTES_LENGTH} characters or fewer.`);
      return;
    }
    savingRef.current = true;
    setActionError("");
    setSaving(true);
    try {
      const updated = await fn();
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      if (isMAO) setRemarks("");
      setToast({ tone: "success", message: success });
    } catch (err) {
      const message = friendlyError(err, "Couldn't save this. Please try again.");
      setActionError(message);
      setToast({ tone: "error", message });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const faChanged = !!selected && (recommended !== selected.recommended || remarks.trim() !== (selected.faRemarks ?? ""));

  return (
    <>
      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {loadError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{loadError}</div>
          )}
          <div className="agri-toolbar">
            {!isMAO && (
              <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setFiling(true)}>
                <Plus size={16} /> Add Farmer Request
              </button>
            )}
            <div className="agri-toolbar-search">
              <Search size={15} />
              <input className="form-control" placeholder="Search farmer, RSBSA no. or commodity" aria-label="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="agri-filter-chips" role="tablist" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`agri-filter-chip${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}
                <span className="agri-filter-chip-count">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead>
                <tr><th>Farmer</th><th>Commodity</th><th className="text-end">Quantity</th><th>Date Requested</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} {...rowLinkProps(() => { setSelectedId(r.id); revealDetail(); }, { selected: r.id === selectedId })}>
                    <td>
                      <span className="agri-farmer-cell">
                        <FarmerAvatar url={r.avatarUrl} firstName={r.farmerFirstName} lastName={r.farmerLastName} size={28} />
                        <span>
                          <span className="agri-row-title">{r.farmerName}</span>
                          {r.filedByFa && <span className="agri-filed-tag" style={{ display: "block", width: "fit-content" }}>Filed by Farmers' Association President</span>}
                        </span>
                      </span>
                    </td>
                    <td>{r.commodity}{r.typeName && <span className="agri-muted"> · {r.typeName}</span>}</td>
                    <td className="text-end">{formatQuantity(r.quantity, r.unit)}</td>
                    <td>{formatDate(r.requestDate)}</td>
                    <td>
                      <Pill status={reviewLabel(r)} />
                      {r.recommended && r.status === "Pending" && <span className="agri-filed-tag" style={{ display: "block", width: "fit-content" }}>Recommended</span>}
                    </td>
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
              <Pill status={reviewLabel(selected)} />
            </div>

            <div className="agri-detail-body">
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Farmer</div>
                  {selected.farmerName}
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>RSBSA No. {selected.rsbsaNo || "—"}</div>
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>{[selected.sitioPurok, selected.barangay].filter(Boolean).join(", ")}</div>
                  {selected.filedByFa && <span className="agri-filed-tag">Filed by Farmers' Association President</span>}
                  {selected.recommended && <span className="agri-filed-tag" style={{ marginLeft: 4 }}>Recommended by Farmers' Association President</span>}
                </div>
              </div>
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Farm Size</div>
                  {formatHectares(selected.farmSize)}
                  {selected.cropType && <span className="agri-muted"> · {selected.cropType}</span>}
                </div>
              </div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Commodity</div>{selected.commodity}{selected.typeName && ` · ${selected.typeName}`}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity Requested</div>{formatQuantity(selected.quantity, selected.unit)}</div></div>
              {selected.suggestedQuantity !== null && (
                <div className="agri-detail-row">
                  <div>
                    <div className="agri-detail-label">Suggested for Farm Size</div>
                    {formatQuantity(selected.suggestedQuantity, selected.unit)}
                    <div className="agri-muted" style={{ fontSize: "0.78rem" }}>
                      {formatHectares(selected.farmSize)} × {selected.allocationPerHectare.toLocaleString()} kg/ha ({selected.rateTypeName})
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
              {actionError && (
                <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{actionError}</div>
              )}
              {pending && isMAO && (
                <div>
                  <label className="agri-form-label" htmlFor="request-notes">Remarks <span className="agri-muted" style={{ fontWeight: 400 }}>(required to reject)</span></label>
                  <textarea id="request-notes" ref={remarksRef} className="form-control mb-3" rows={2} maxLength={MAX_NOTES_LENGTH} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Shown to the farmer" disabled={saving} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn btn-outline-danger flex-fill" onClick={() => decide("reject")} disabled={saving}>Reject</button>
                    <button type="button" className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => decide("approve")} disabled={saving}>
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                </div>
              )}
              {pending && !isMAO && (
                <div>
                  <div className="form-check mb-2">
                    <input id="request-recommend" className="form-check-input" type="checkbox" checked={recommended} onChange={(e) => setRecommended(e.target.checked)} disabled={saving} />
                    <label className="form-check-label" htmlFor="request-recommend" style={{ fontSize: "0.85rem" }}>Recommended by Farmers' Association President</label>
                  </div>
                  <label className="agri-form-label" htmlFor="request-notes">Remark for the MAO (optional)</label>
                  <textarea id="request-notes" ref={remarksRef} className="form-control mb-3" rows={2} maxLength={MAX_NOTES_LENGTH} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Verified with the farmer" disabled={saving} />
                  <button type="button" className="btn btn-agri-primary w-100 d-flex align-items-center justify-content-center gap-2" onClick={saveRecommendation} disabled={saving || !faChanged}>
                    <Send size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <div className="agri-field-hint">Optional. The MAO Admin decides either way.</div>
                </div>
              )}
              {!pending && (
                <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                  <ShieldAlert size={13} style={{ flex: "none" }} />
                  This request has already been decided.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {filing && (
        <FarmerRequestModal
          onClose={() => setFiling(false)}
          onSaved={(saved) => {
            setRequests((prev) => [saved, ...prev]);
            setFiling(false);
            setSearch("");
            setFilter("all");
            setSelectedId(saved.id);
            setToast({ tone: "success", message: `Request filed for ${saved.farmerName} and sent to the MAO.` });
          }}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, Eye, FileText, Pencil, Plus, Search, ShieldAlert, XCircle } from "lucide-react";
import Pill from "../ui/Pill.jsx";
import Toast from "../ui/Toast.jsx";
import TableFooter from "../ui/TableFooter.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import AssociationRequestModal from "./AssociationRequestModal.jsx";
import { useSupabaseList } from "../../hooks/useSupabaseList.js";
import { usePagination } from "../../hooks/usePagination.js";
import { useFitPageSize } from "../../hooks/useFitPageSize.js";
import { useCardLabels } from "../../hooks/useCardLabels.js";
import { useRevealDetail } from "../../hooks/useRevealDetail.js";
import {
  ASSOCIATION_STATUSES,
  ASSOCIATION_TYPES,
  LIMITS,
  cancelAssociationRequest,
  getAttachmentUrl,
  listAssociationRequests,
  reviewAssociationRequest,
} from "../../lib/api/associationRequests.js";
import { formatDate, formatDateTime } from "../../lib/dates.js";
import { friendlyError } from "../../lib/friendlyError.js";
import { rowLinkProps } from "../../lib/rowLink.js";

const FILTERS = [{ value: "all", label: "All" }, ...ASSOCIATION_STATUSES];

// Association Requests tab of the Requests page.
//   Farmers' Association President: "New Association Request", their own
//     requests with status and the MAO's remarks; Edit / Cancel while Pending.
//   MAO Admin: every request; Mark under review, Approve, Reject (remarks
//     required to reject).
export default function AssociationRequestsView({ isMAO }) {
  const { data: requests, setData: setRequests, loading, error: loadError } = useSupabaseList(listAssociationRequests);
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // null | { request: null | request }
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [toast, setToast] = useState(null);
  const remarksRef = useRef(null);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(
      (r) =>
        (typeFilter === "all" || r.type === typeFilter) &&
        (!q || r.title.toLowerCase().includes(q) || r.item.toLowerCase().includes(q) || r.requesterName.toLowerCase().includes(q)),
    );
  }, [requests, search, typeFilter]);
  const filtered = useMemo(() => (filter === "all" ? searched : searched.filter((r) => r.statusKey === filter)), [searched, filter]);
  const counts = useMemo(() => {
    const c = { all: searched.length };
    for (const r of searched) c[r.statusKey] = (c[r.statusKey] ?? 0) + 1;
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
  useEffect(() => {
    setRemarks("");
    setActionError("");
  }, [selectedId]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const decided = selected && (selected.statusKey === "approved" || selected.statusKey === "rejected");
  const faCanEdit = !isMAO && selected?.statusKey === "pending";

  async function review(status) {
    if (!selected || savingRef.current) return;
    if (status === "rejected" && !remarks.trim()) {
      setActionError("Give a reason for rejecting this request.");
      remarksRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setActionError("");
    try {
      const updated = await reviewAssociationRequest(selected.id, status, remarks);
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setRemarks("");
      setToast({ tone: "success", message: { under_review: "Marked as under review.", approved: "Request approved.", rejected: "Request rejected." }[status] });
    } catch (err) {
      const message = friendlyError(err, "Couldn't save this decision. Please try again.");
      setActionError(message);
      setToast({ tone: "error", message });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function cancelRequest() {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await cancelAssociationRequest(selected.id);
      setConfirmCancel(false);
      setRequests((prev) => prev.filter((r) => r.id !== selected.id));
      setToast({ tone: "success", message: "Request cancelled." });
    } catch (err) {
      setConfirmCancel(false);
      setToast({ tone: "error", message: friendlyError(err, "Couldn't cancel this request. Please try again.") });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function openAttachment() {
    // Opened right away (before the link is fetched) so the browser doesn't
    // treat it as a pop-up; filled in once the short-lived link is ready.
    const win = window.open("", "_blank");
    try {
      const url = await getAttachmentUrl(selected.attachmentPath);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else window.location.assign(url);
    } catch (err) {
      win?.close();
      setToast({ tone: "error", message: friendlyError(err, "Couldn't open the attachment. Please try again.") });
    }
  }

  // The FA President's note once a request is past Pending.
  function readOnlyNote() {
    if (selected.statusKey === "under_review") return "The MAO is reviewing this request.";
    if (selected.statusKey === "approved") return "Approved by the MAO.";
    return "Rejected by the MAO. See the remarks above.";
  }

  return (
    <>
      <div className={`agri-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {loadError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{loadError}</div>
          )}
          <div className="agri-toolbar">
            {!isMAO && (
              <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({ request: null })}>
                <Plus size={16} /> New Association Request
              </button>
            )}
            <div className="agri-toolbar-search">
              <Search size={15} />
              <input className="form-control" placeholder="Search title or item" aria-label="Search association requests" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "140px" }} aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              {ASSOCIATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="agri-filter-chips" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                className={`agri-filter-chip${filter === f.value ? " active" : ""}`}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                <span className="agri-filter-chip-count">{counts[f.value] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards">
              <thead>
                <tr><th>Request</th><th>Type</th><th>Quantity</th><th>Preferred Date</th><th>Submitted</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} {...rowLinkProps(() => { setSelectedId(r.id); revealDetail(); }, { selected: r.id === selectedId })}>
                    <td className="agri-cell-truncate" title={r.title}>
                      <span className="agri-row-title">{r.title}</span>
                      {r.item && <div className="agri-muted" style={{ fontSize: "0.75rem" }}>{r.item}</div>}
                    </td>
                    <td>{r.typeLabel}</td>
                    <td>{r.quantity ?? "—"}</td>
                    <td>{r.preferredDate ? formatDate(r.preferredDate) : "—"}</td>
                    <td>{formatDate(r.createdAt)}</td>
                    <td><Pill status={r.status} /></td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={6} className="agri-muted text-center py-4">Loading association requests…</td></tr>
                )}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <EmptyState
                icon={ClipboardList}
                title="No association requests found"
                hint={
                  search || typeFilter !== "all" || filter !== "all"
                    ? "Try a different search or clear the filters."
                    : isMAO
                      ? "Requests from the Farmers' Association President appear here."
                      : "Use New Association Request to ask the MAO for machinery, a project or other support."
                }
              />
            )}
          </div>
          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["request", "requests"]} />
        </div>

        {selected && (
          <div ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Association Request</div>
              <Pill status={selected.status} />
            </div>
            <div className="agri-detail-body">
              <div className="agri-detail-row"><div><div className="agri-detail-label">Title</div><span style={{ overflowWrap: "anywhere" }}>{selected.title}</span></div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Type</div>{selected.typeLabel}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Item</div>{selected.item || <span className="agri-muted">—</span>}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Quantity</div>{selected.quantity ?? <span className="agri-muted">—</span>}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Estimated Beneficiaries</div>{selected.estimatedBeneficiaries != null ? `${selected.estimatedBeneficiaries.toLocaleString()} farmers` : <span className="agri-muted">—</span>}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Preferred Date</div>{selected.preferredDate ? formatDate(selected.preferredDate) : <span className="agri-muted">—</span>}</div></div>
              <div className="agri-detail-row"><div><div className="agri-detail-label">Description / Justification</div><span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.description}</span></div></div>
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Attachment</div>
                  {selected.attachmentPath ? (
                    <button type="button" className="agri-attachment-link" onClick={openAttachment}>
                      <FileText size={14} /> {selected.attachmentName || "View attachment"} <Eye size={13} />
                    </button>
                  ) : (
                    <span className="agri-muted">None</span>
                  )}
                </div>
              </div>

              <div className="agri-detail-section-title">Timeline</div>
              <ol className="agri-timeline">
                <li className="agri-timeline-step done">
                  <span className="agri-timeline-dot" aria-hidden="true" />
                  <div className="agri-timeline-title">Submitted</div>
                  <div className="agri-timeline-meta">by {selected.requesterName} (Farmers' Association President) · {formatDateTime(selected.createdAt)}</div>
                </li>
                {selected.statusKey === "pending" ? (
                  <li className="agri-timeline-step waiting">
                    <span className="agri-timeline-dot" aria-hidden="true" />
                    <div className="agri-timeline-title">Waiting for the MAO</div>
                    <div className="agri-timeline-meta">MAO Admin</div>
                  </li>
                ) : (
                  <li className={`agri-timeline-step ${selected.statusKey === "rejected" ? "rejected" : selected.statusKey === "approved" ? "done" : "waiting"}`}>
                    <span className="agri-timeline-dot" aria-hidden="true" />
                    <div className="agri-timeline-title">{selected.status}</div>
                    <div className="agri-timeline-meta">by {selected.reviewerName} · {selected.reviewedAt ? formatDateTime(selected.reviewedAt) : "date not recorded"}</div>
                    {selected.adminRemarks && <div className="agri-timeline-remarks">“{selected.adminRemarks}”</div>}
                  </li>
                )}
              </ol>
            </div>

            <div className="agri-detail-actions">
              {actionError && (
                <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{actionError}</div>
              )}
              {isMAO && !decided && (
                <div>
                  <label className="agri-form-label" htmlFor="assoc-remarks">Remarks <span className="agri-muted" style={{ fontWeight: 400 }}>(required to reject)</span></label>
                  <textarea
                    id="assoc-remarks"
                    ref={remarksRef}
                    className="form-control mb-3"
                    rows={2}
                    maxLength={LIMITS.remarks}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Shown to the Farmers' Association President"
                    disabled={saving}
                  />
                  {selected.statusKey === "pending" && (
                    <button type="button" className="btn agri-detail-btn agri-detail-btn-edit w-100 d-flex align-items-center justify-content-center gap-2 mb-2" onClick={() => review("under_review")} disabled={saving}>
                      <Eye size={15} /> Mark under review
                    </button>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn btn-outline-danger flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => review("rejected")} disabled={saving}>
                      <XCircle size={14} /> Reject
                    </button>
                    <button type="button" className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => review("approved")} disabled={saving}>
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                </div>
              )}
              {faCanEdit && (
                <div className="agri-detail-actions-row">
                  <button type="button" className="btn agri-detail-btn agri-detail-btn-edit d-flex align-items-center justify-content-center gap-2" onClick={() => setModal({ request: selected })} disabled={saving}>
                    <Pencil size={16} /> Edit
                  </button>
                  <button type="button" className="btn agri-detail-btn agri-detail-btn-delete d-flex align-items-center justify-content-center gap-2" onClick={() => setConfirmCancel(true)} disabled={saving}>
                    <XCircle size={16} /> Cancel Request
                  </button>
                </div>
              )}
              {((isMAO && decided) || (!isMAO && !faCanEdit)) && (
                <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                  <ShieldAlert size={13} style={{ flex: "none" }} />
                  {isMAO ? "This request has already been decided." : readOnlyNote()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {modal && (
        <AssociationRequestModal
          request={modal.request}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            setRequests((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev]));
            setSelectedId(saved.id);
            setFilter("all");
            setModal(null);
            setToast({ tone: "success", message: modal.request ? "Request updated." : "Request sent to the MAO." });
          }}
        />
      )}

      {confirmCancel && selected && (
        <ConfirmDialog
          title="Cancel this request?"
          message={`"${selected.title}" will be withdrawn and the MAO won't act on it. This can't be undone.`}
          confirmLabel="Cancel Request"
          busy={saving}
          onConfirm={cancelRequest}
          onCancel={() => setConfirmCancel(false)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </>
  );
}

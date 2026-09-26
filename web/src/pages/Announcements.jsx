import { useMemo, useState } from "react";
import { EyeOff, Megaphone, Pencil, Pin, PinOff, Plus, Search, Send, Trash2 } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import AnnouncementModal from "../components/announcements/AnnouncementModal.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import {
  CATEGORIES,
  deleteAnnouncement,
  listAnnouncements,
  setAnnouncementPinned,
  setAnnouncementStatus,
} from "../lib/api/announcements.js";

const PAGE_SIZE = 10;

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export default function Announcements() {
  const { data: announcements, setData: setAnnouncements, loading, error: loadError } = useSupabaseList(listAnnouncements);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [modal, setModal] = useState(null); // null | { announcement? }
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return announcements.filter(
      (a) =>
        (statusFilter === "All" || a.status === statusFilter) &&
        (categoryFilter === "All" || a.category === categoryFilter) &&
        (!q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)),
    );
  }, [announcements, search, statusFilter, categoryFilter]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);
  const filtersActive = search || statusFilter !== "All" || categoryFilter !== "All";

  function resetFilters() {
    setSearch("");
    setStatusFilter("All");
    setCategoryFilter("All");
  }

  // Pinned first, then newest — same order the farmer app uses.
  function sortList(list) {
    return [...list].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || new Date(b.createdAt) - new Date(a.createdAt));
  }

  function handleSaved(saved, { editing, status, published }) {
    setAnnouncements((prev) => sortList(editing ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev]));
    setModal(null);
    setToast({
      tone: "success",
      message: published ? "Announcement published." : status === "Published" ? "Announcement updated." : "Draft saved.",
    });
  }

  async function run(a, action, successMessage) {
    setBusyId(a.id);
    try {
      const updated = await action();
      setAnnouncements((prev) => sortList(prev.map((x) => (x.id === a.id ? { ...updated } : x))));
      setToast({ tone: "success", message: successMessage });
    } catch (err) {
      setToast({ tone: "error", message: err.message || "Something went wrong. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  const togglePin = (a) => run(a, () => setAnnouncementPinned(a.id, !a.isPinned), a.isPinned ? "Announcement unpinned." : "Announcement pinned.");
  const togglePublish = (a) =>
    run(
      a,
      () => setAnnouncementStatus(a.id, a.status === "Published" ? "Draft" : "Published"),
      a.status === "Published" ? "Announcement unpublished." : "Announcement published.",
    );

  async function confirmDelete() {
    const a = pendingDelete;
    setPendingDelete(null);
    setBusyId(a.id);
    try {
      await deleteAnnouncement(a.id, a.imagePath);
      setAnnouncements((prev) => prev.filter((x) => x.id !== a.id));
      setToast({ tone: "success", message: "Announcement deleted." });
    } catch (err) {
      setToast({ tone: "error", message: err.message || "Couldn't delete the announcement." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="agri-fill-root">
      <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
        {loadError && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{loadError}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({})}>
            <Plus size={16} /> New Announcement
          </button>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
            <input className="form-control" placeholder="Search announcements" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="form-select" style={{ width: 140 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="All">All Status</option>
            <option>Published</option>
            <option>Draft</option>
          </select>
          <select className="form-select" style={{ width: 190 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="agri-table-wrap">
          <table className="agri-table">
            <thead>
              <tr><th>Announcement</th><th>Category</th><th>Audience</th><th>Status</th><th>Published</th><th>Expires</th><th>Read by</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pageItems.map((a) => (
                <tr key={a.id}>
                  <td style={{ maxWidth: 280 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                      {a.isPinned && <Pin size={13} color="var(--agri-primary-dark)" aria-label="Pinned" />}
                      <span className="agri-cell-truncate" style={{ maxWidth: 250 }} title={a.title}>{a.title}</span>
                    </div>
                    <div className="agri-muted agri-cell-truncate" style={{ fontSize: "0.75rem", maxWidth: 260 }} title={a.body}>{a.body}</div>
                  </td>
                  <td><Pill status={a.category} /></td>
                  <td>{a.audience}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <Pill status={a.status} />
                      {a.status === "Published" && a.expired && <span className="agri-pill gray">Expired</span>}
                    </div>
                  </td>
                  <td>{a.status === "Published" ? formatDate(a.publishedAt) : "—"}</td>
                  <td>{formatDate(a.expiresAt)}</td>
                  <td>{a.status === "Published" ? a.readCount : "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="agri-icon-btn" title="Edit" aria-label={`Edit ${a.title}`} onClick={() => setModal({ announcement: a })} disabled={busyId === a.id}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="agri-icon-btn" title={a.isPinned ? "Unpin" : "Pin to top"} aria-label={a.isPinned ? "Unpin" : "Pin to top"} onClick={() => togglePin(a)} disabled={busyId === a.id}>
                        {a.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      <button type="button" className="agri-icon-btn" title={a.status === "Published" ? "Unpublish" : "Publish"} aria-label={a.status === "Published" ? "Unpublish" : "Publish"} onClick={() => togglePublish(a)} disabled={busyId === a.id}>
                        {a.status === "Published" ? <EyeOff size={14} /> : <Send size={14} />}
                      </button>
                      <button type="button" className="agri-icon-btn" title="Delete" aria-label={`Delete ${a.title}`} onClick={() => setPendingDelete(a)} disabled={busyId === a.id}>
                        <Trash2 size={14} color="var(--agri-red)" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={8} className="agri-muted text-center py-4">Loading announcements…</td></tr>
              )}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={Megaphone}
              title="No announcements found"
              hint={filtersActive ? "Try a different search or clear the filters." : "Post your first announcement and farmers will see it in the app."}
              action={
                filtersActive ? (
                  <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={resetFilters}>Clear filters</button>
                ) : (
                  <button type="button" className="btn btn-agri-primary btn-sm mt-2" onClick={() => setModal({})}>New Announcement</button>
                )
              }
            />
          )}
        </div>
        <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>Showing {pageItems.length} of {filtered.length} announcements</div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {modal && <AnnouncementModal announcement={modal.announcement} onClose={() => setModal(null)} onSaved={handleSaved} />}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete announcement?"
          message={`"${pendingDelete.title}" will be removed for everyone, including farmers who already read it. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

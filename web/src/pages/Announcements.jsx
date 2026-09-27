import { useMemo, useState } from "react";
import { Megaphone, Pencil, Pin, PinOff, Plus, Search, Send, Trash2 } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import RowActionsMenu from "../components/ui/RowActionsMenu.jsx";
import AnnouncementModal from "../components/announcements/AnnouncementModal.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import {
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
  const [modal, setModal] = useState(null); // null | { announcement? }
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return announcements.filter(
      (a) =>
        (statusFilter === "All" || a.status === statusFilter) &&
        (!q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)),
    );
  }, [announcements, search, statusFilter]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);
  const filtersActive = search || statusFilter !== "All";

  function resetFilters() {
    setSearch("");
    setStatusFilter("All");
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
  const publish = (a) => run(a, () => setAnnouncementStatus(a.id, "Published"), "Announcement published.");

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
        </div>

        <div className="agri-table-wrap">
          <table className="agri-table">
            <thead>
              <tr><th>Announcement</th><th>Recipients</th><th>Status</th><th>Published</th><th></th></tr>
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
                  <td>{a.recipients.join(", ")}</td>
                  <td><Pill status={a.status} /></td>
                  <td>{a.status === "Published" ? formatDate(a.publishedAt) : "—"}</td>
                  <td>
                    <RowActionsMenu
                      label={`Actions for ${a.title}`}
                      actions={[
                        { key: "edit", label: "Edit", icon: Pencil, onClick: () => setModal({ announcement: a }) },
                        { key: "pin", label: a.isPinned ? "Unpin" : "Pin to top", icon: a.isPinned ? PinOff : Pin, onClick: () => togglePin(a) },
                        a.status === "Draft" && { key: "publish", label: "Publish", icon: Send, onClick: () => publish(a) },
                        { key: "delete", label: "Delete", icon: Trash2, danger: true, onClick: () => setPendingDelete(a) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={5} className="agri-muted text-center py-4">Loading announcements…</td></tr>
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

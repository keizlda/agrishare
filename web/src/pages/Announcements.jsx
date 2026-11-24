import { useEffect, useMemo, useState } from "react";
import { Megaphone, Pencil, Pin, PinOff, Plus, Search, Send, Trash2 } from "lucide-react";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import RowActionsMenu from "../components/ui/RowActionsMenu.jsx";
import AnnouncementModal from "../components/announcements/AnnouncementModal.jsx";
import PostCard from "../components/announcements/PostCard.jsx";
import PostDetailModal from "../components/announcements/PostDetailModal.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { friendlyError } from "../lib/friendlyError.js";
import { formatDate, formatDateLong, formatDateNumeric, formatTime } from "../lib/dates.js";
import maoSeal from "../assets/mao-seal.png";
import { deleteAnnouncement, forwardAnnouncementToFarmers, listAnnouncements, setAnnouncementPinned } from "../lib/api/announcements.js";
import { listEntries } from "../lib/api/lists.js";

// Pinned posts stay on top; then by when they were posted.
function sortPosts(list, order = "newest") {
  const dir = order === "oldest" ? 1 : -1;
  return [...list].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || dir * (new Date(a.postedAt) - new Date(b.postedAt)));
}

// What the search box looks through: the title, details, venue, and the
// post's dates the way they're shown or typed ("Oct 23, 2026", "October
// 23, 2026", "10/23/2026", "2026-10-23"), its time and when it was posted.
function searchText(a) {
  const dates = (v) => (v ? [formatDate(v), formatDateLong(v), formatDateNumeric(v), String(v).slice(0, 10)] : []);
  return [a.title, a.body, a.venue, ...dates(a.date), a.time && formatTime(a.time), ...dates(a.postedAt)].filter(Boolean).join(" \n").toLowerCase();
}

// Announcements as a feed of posts. The MAO Admin creates posts and has
// Edit / Pin / Delete on each (⋯); the Farmers' Association President reads
// the posts meant for them and can forward one to farmers. Clicking a post
// opens it in full.
export default function Announcements() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  const { data: announcements, setData: setAnnouncements, loading, error: loadError } = useSupabaseList(listAnnouncements);
  const [barangays, setBarangays] = useState([]);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("newest");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [modal, setModal] = useState(null); // null | { announcement? }
  const [open, setOpen] = useState(null); // the post shown in full
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    listEntries("barangays").then(setBarangays).catch(() => {});
  }, []);

  const posts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const brgy = barangayFilter === "all" ? null : Number(barangayFilter);
    const shown = announcements.filter((a) => (!q || searchText(a).includes(q)) && (brgy == null || a.allBarangays || a.barangayIds.includes(brgy)));
    return sortPosts(shown, order);
  }, [announcements, search, barangayFilter, order]);
  const filtering = !!search.trim() || barangayFilter !== "all";

  function handleSaved(saved, { editing }) {
    setAnnouncements((prev) => (editing ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev]));
    setModal(null);
    setToast({ tone: "success", message: editing ? "Post updated." : "Posted." });
  }

  async function run(a, action, successMessage) {
    try {
      const updated = await action();
      setAnnouncements((prev) => prev.map((x) => (x.id === a.id ? { ...updated } : x)));
      setToast({ tone: "success", message: successMessage });
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Something went wrong. Please try again.") });
    }
  }

  const togglePin = (a) => run(a, () => setAnnouncementPinned(a.id, !a.isPinned), a.isPinned ? "Post unpinned." : "Post pinned to the top.");
  const forward = (a) => run(a, () => forwardAnnouncementToFarmers(a.id), "Post forwarded to farmers.");

  async function confirmDelete() {
    const a = pendingDelete;
    setDeleting(true);
    try {
      await deleteAnnouncement(a.id);
      setAnnouncements((prev) => prev.filter((x) => x.id !== a.id));
      setToast({ tone: "success", message: "Post deleted." });
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't delete the post.") });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const menuFor = (a) => (
    <RowActionsMenu
      label={`Actions for post: ${a.title}`}
      actions={
        isMAO
          ? [
              { key: "edit", label: "Edit", icon: Pencil, onClick: () => setModal({ announcement: a }) },
              { key: "pin", label: a.isPinned ? "Unpin" : "Pin", icon: a.isPinned ? PinOff : Pin, onClick: () => togglePin(a) },
              { key: "delete", label: "Delete", icon: Trash2, danger: true, onClick: () => setPendingDelete(a) },
            ]
          : [a.audience === "fa_president" && { key: "forward", label: "Forward to farmers", icon: Send, onClick: () => forward(a) }]
      }
    />
  );

  return (
    <div className="agri-fill-root">
      <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
        {loadError && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{loadError}</div>
        )}

        <div className="agri-toolbar">
          {isMAO && (
            <button className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({})}>
              <Plus size={16} /> Create post
            </button>
          )}
          <div className="agri-toolbar-search">
            <Search size={15} />
            <input className="form-control" placeholder="Search title, details, venue or date" aria-label="Search posts" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "150px" }} value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Sort posts">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "180px" }} value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} aria-label="Filter by barangay">
            <option value="all">All barangays</option>
            {barangays.map((b) => (
              <option key={b.id} value={String(b.id)}>{b.name}{b.isActive ? "" : " (deactivated)"}</option>
            ))}
          </select>
        </div>

        <div className="agri-post-feed">
          <div className="agri-post-feed-inner">
            {isMAO && (
              <button type="button" className="agri-card agri-post-composer" onClick={() => setModal({})}>
                <img src={maoSeal} alt="" className="agri-post-avatar" />
                <span>What do you want to announce?</span>
              </button>
            )}
            {loading && <div className="agri-muted text-center py-4">Loading posts…</div>}
            {posts.map((a) => <PostCard key={a.id} post={a} barangays={barangays} menu={menuFor(a)} onOpen={setOpen} />)}
            {!loading && posts.length === 0 && (
              <EmptyState
                icon={Megaphone}
                title={filtering ? "No posts found" : "No posts yet"}
                hint={filtering ? "Try a different search or barangay." : isMAO ? "Create a post and the farmers and Farmers' Association Presidents you choose will see it." : "Posts from the MAO will show up here."}
              />
            )}
          </div>
        </div>
      </div>

      {modal && <AnnouncementModal announcement={modal.announcement} barangays={barangays.length ? barangays : undefined} onClose={() => setModal(null)} onSaved={handleSaved} />}

      {open && <PostDetailModal post={open} barangays={barangays} onClose={() => setOpen(null)} />}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this post?"
          message="It will be removed for everyone, including farmers who already saw it."
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

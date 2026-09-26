import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, CheckCircle2, Inbox, MailOpen, Mail, MoreHorizontal, Package, ShieldCheck, Trash2, X, XCircle } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import Toast from "../ui/Toast.jsx";
import {
  clearReadNotifications,
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
} from "../../lib/api/notifications.js";

const PAGE_SIZE = 20;
const POLL_MS = 60000;
const UNDO_MS = 5000;

const TYPE_ICON = {
  validated: { Icon: CheckCircle2, color: "var(--agri-primary-dark)", bg: "var(--agri-primary-light)" },
  rejected: { Icon: XCircle, color: "var(--agri-red)", bg: "var(--agri-red-bg)" },
  validation: { Icon: ShieldCheck, color: "var(--agri-blue)", bg: "var(--agri-blue-bg)" },
  request: { Icon: Inbox, color: "var(--agri-purple)", bg: "var(--agri-purple-bg)" },
  distribution: { Icon: Package, color: "var(--agri-orange)", bg: "var(--agri-orange-bg)" },
  system: { Icon: Bell, color: "#667066", bg: "#f1f3f1" },
};

function relativeTime(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupLabel(iso) {
  const d = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  if (d >= startOfToday) return "Today";
  if (d >= new Date(startOfToday.getTime() - dayMs)) return "Yesterday";
  return "Earlier";
}

function insertSorted(list, item) {
  const next = [...list, item];
  next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return next;
}

// variant "sheet" is the full-screen version MobileShell uses on phones.
export default function NotificationBell({ open, onToggle, onClose, variant = "dropdown" }) {
  const sheet = variant === "sheet";
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState(null);
  const pendingDeletes = useRef(new Map());

  const refreshCount = useCallback(() => {
    getUnreadCount().then(setUnread).catch(() => {});
  }, []);

  const load = useCallback(async (which) => {
    setLoading(true);
    try {
      const { items: rows, hasMore: more } = await listNotifications({ limit: PAGE_SIZE, unreadOnly: which === "unread" });
      setItems(rows);
      setHasMore(more);
    } catch {
      setToast({ tone: "error", message: "Couldn't load notifications." });
    } finally {
      setLoading(false);
    }
    refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (open) load(tab);
    else setMenuId(null);
  }, [open, tab, load]);

  // Anything still inside its undo window when the bar unmounts (logout,
  // navigation away) is committed rather than silently dropped.
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        deleteNotification(id).catch(() => {});
      }
      pending.clear();
    };
  }, []);

  const visible = useMemo(() => (tab === "unread" ? items.filter((n) => !n.isRead) : items), [items, tab]);

  const groups = useMemo(() => {
    const order = ["Today", "Yesterday", "Earlier"];
    const map = new Map(order.map((g) => [g, []]));
    for (const n of visible) map.get(groupLabel(n.createdAt)).push(n);
    return order.filter((g) => map.get(g).length > 0).map((g) => ({ label: g, rows: map.get(g) }));
  }, [visible]);

  // Runs an optimistic mutation: `apply` updates local state right away,
  // `request` hits the API, and any failure rolls back to the snapshot.
  async function optimistic(apply, request, errorMessage) {
    const snapshot = { items, unread, hasMore };
    apply();
    try {
      await request();
      refreshCount();
    } catch {
      setItems(snapshot.items);
      setUnread(snapshot.unread);
      setHasMore(snapshot.hasMore);
      setToast({ tone: "error", message: errorMessage });
    }
  }

  function setRead(n, isRead) {
    if (n.isRead === isRead) return Promise.resolve();
    return optimistic(
      () => {
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead } : x)));
        setUnread((c) => Math.max(0, c + (isRead ? -1 : 1)));
      },
      () => (isRead ? markNotificationRead(n.id) : markNotificationUnread(n.id)),
      isRead ? "Couldn't mark as read." : "Couldn't mark as unread.",
    );
  }

  function markAllRead() {
    return optimistic(
      () => {
        setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
        setUnread(0);
      },
      markAllNotificationsRead,
      "Couldn't mark all as read.",
    );
  }

  function handleOpenItem(n) {
    setRead(n, true);
    onClose();
    if (n.link) navigate(n.link);
  }

  // Delete is deferred for the length of the Undo toast: the row leaves the
  // list immediately, but the DELETE only fires once the window closes, so
  // Undo is a plain local restore (clients have no INSERT policy to re-create
  // a row with).
  function handleDelete(n) {
    setMenuId(null);
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.isRead) setUnread((c) => Math.max(0, c - 1));

    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(n.id);
      try {
        await deleteNotification(n.id);
        refreshCount();
      } catch {
        setItems((prev) => insertSorted(prev, n));
        if (!n.isRead) setUnread((c) => c + 1);
        setToast({ tone: "error", message: "Couldn't delete the notification." });
      }
    }, UNDO_MS);
    pendingDeletes.current.set(n.id, { timer });

    setToast({
      tone: "success",
      message: "Notification deleted.",
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          pendingDeletes.current.delete(n.id);
          setItems((prev) => insertSorted(prev, n));
          if (!n.isRead) setUnread((c) => c + 1);
          setToast(null);
        },
      },
    });
  }

  async function handleClearRead() {
    setConfirmClear(false);
    await optimistic(
      () => setItems((prev) => prev.filter((x) => !x.isRead)),
      clearReadNotifications,
      "Couldn't clear notifications.",
    );
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { items: rows, hasMore: more } = await listNotifications({ limit: PAGE_SIZE, offset: items.length, unreadOnly: tab === "unread" });
      setItems((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
      setHasMore(more);
    } catch {
      setToast({ tone: "error", message: "Couldn't load more notifications." });
    } finally {
      setLoadingMore(false);
    }
  }

  const badge = unread > 9 ? "9+" : String(unread);
  const hasRead = items.some((n) => n.isRead);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={sheet ? "agri-mshell-bell" : "agri-icon-btn agri-bell"}
        onClick={onToggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
      >
        <Bell size={17} />
        {unread > 0 && <span className={sheet ? "agri-mshell-badge" : "badge"} aria-hidden="true">{badge}</span>}
      </button>

      {open && (
        <div className={sheet ? "agri-mshell-sheet agri-notif-sheet" : "agri-card agri-notif-panel"} role="dialog" aria-label="Notifications">
          <div className="agri-notif-header">
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Notifications</div>
              <div className="agri-muted" style={{ fontSize: "0.72rem" }}>{unread > 0 ? `${unread} unread` : "All caught up"}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.78rem" }} onClick={markAllRead} disabled={unread === 0}>
                Mark all as read
              </button>
              {sheet && (
                <button type="button" className="agri-mshell-close" onClick={onClose} aria-label="Close">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          <div className="agri-notif-tabs" role="tablist" aria-label="Filter notifications">
            {[["all", "All"], ["unread", "Unread"]].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`agri-notif-tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          <div className="agri-notif-list">
            {loading && visible.length === 0 && <div className="agri-muted agri-notif-empty">Loading…</div>}

            {!loading && visible.length === 0 && (
              <div className="agri-notif-empty">
                <BellOff size={30} color="#b7c2ba" />
                <div style={{ fontWeight: 600, marginTop: 8 }}>You're all caught up</div>
                <div className="agri-muted" style={{ fontSize: "0.78rem" }}>{tab === "unread" ? "No unread notifications." : "New activity will show up here."}</div>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.label}>
                <div className="agri-notif-group">{g.label}</div>
                <ul className="agri-notif-items">
                  {g.rows.map((n) => {
                    const t = TYPE_ICON[n.type] ?? TYPE_ICON.system;
                    return (
                      <li key={n.id} className={`agri-notif-item${n.isRead ? "" : " unread"}`}>
                        <button type="button" className="agri-notif-main" onClick={() => handleOpenItem(n)}>
                          <span className="agri-notif-icon" style={{ background: t.bg, color: t.color }}>
                            <t.Icon size={16} />
                          </span>
                          <span className="agri-notif-body">
                            <span className="agri-notif-title">{n.title}</span>
                            <span className="agri-notif-message">{n.message}</span>
                            <span className="agri-notif-time">{relativeTime(n.createdAt)}</span>
                          </span>
                          {!n.isRead && <span className="agri-notif-dot" aria-label="Unread" />}
                        </button>

                        <div className="agri-notif-actions">
                          <button
                            type="button"
                            className="agri-notif-action"
                            title={n.isRead ? "Mark as unread" : "Mark as read"}
                            aria-label={n.isRead ? "Mark as unread" : "Mark as read"}
                            onClick={() => setRead(n, !n.isRead)}
                          >
                            {n.isRead ? <Mail size={14} /> : <MailOpen size={14} />}
                          </button>
                          <button type="button" className="agri-notif-action danger" title="Delete" aria-label="Delete notification" onClick={() => handleDelete(n)}>
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="agri-notif-more"
                          aria-label="More actions"
                          aria-expanded={menuId === n.id}
                          onClick={() => setMenuId(menuId === n.id ? null : n.id)}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {menuId === n.id && (
                          <div className="agri-notif-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => { setMenuId(null); setRead(n, !n.isRead); }}>
                              {n.isRead ? "Mark as unread" : "Mark as read"}
                            </button>
                            <button type="button" role="menuitem" className="danger" onClick={() => handleDelete(n)}>Delete</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {hasMore && (
              <div style={{ padding: 10, textAlign: "center" }}>
                <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.8rem" }} onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>

          <div className="agri-notif-footer">
            <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.8rem", color: "var(--agri-red)" }} onClick={() => setConfirmClear(true)} disabled={!hasRead}>
              Clear all read
            </button>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear read notifications?"
          message="This permanently removes every notification you've already read. Unread ones are kept."
          confirmLabel="Clear"
          onConfirm={handleClearRead}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} action={toast.action} onDone={() => setToast(null)} />}
    </div>
  );
}

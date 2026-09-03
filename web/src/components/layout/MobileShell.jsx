import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronRight,
  FileBarChart2,
  Home,
  Inbox,
  LogOut,
  Package,
  ShieldCheck,
  Settings,
  Sprout,
  Star,
  Truck,
  User as UserIcon,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { listRecentActivity } from "../../lib/api/activity.js";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";

// Mirrors the mobile app's MainTabs (Home/Farmers/Distributions always
// visible, everything else — including anything MAO-only — behind a More
// tab styled like the app's own MoreScreen) rather than trying to cram
// Topbar's full 6-item desktop nav into a bottom bar.
const TABS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/farmers", label: "Farmers", icon: Users },
  { to: "/distributions", label: "Distributions", icon: Truck },
];

const MORE_ITEMS = [
  { to: "/validation", label: "Validation", icon: ShieldCheck, roles: ["MAO Admin"] },
  { to: "/requests", label: "Requests", icon: Inbox, roles: ["MAO Admin", "FA President"] },
  { to: "/reports", label: "Reports", icon: FileBarChart2, roles: ["MAO Admin"] },
  { to: "/commodities", label: "Commodities", icon: Star, roles: ["MAO Admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["MAO Admin"] },
];

export default function MobileShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "MAO Admin";
  const moreItems = MORE_ITEMS.filter((item) => item.roles.includes(role));

  const [panel, setPanel] = useState(null); // "more" | "notif" | null
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => new Set());

  useEscapeToClose(panel !== null, () => setPanel(null));

  useEffect(() => {
    listRecentActivity().then(setNotifications).catch(() => {});
  }, []);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  function handleLogout() {
    setPanel(null);
    logout();
    navigate("/login");
  }

  return (
    <div className="agri-mshell">
      <header className="agri-mshell-header">
        <Link to="/" className="agri-mshell-logo">
          <Sprout size={22} color="var(--agri-primary)" />
          <span>AGRI<em>SHARE</em></span>
        </Link>
        <button className="agri-mshell-bell" onClick={() => setPanel("notif")} aria-label="Notifications">
          <Bell size={17} />
          {unreadCount > 0 && <span className="agri-mshell-dot" />}
        </button>
      </header>

      <main className="agri-mshell-content">
        <Outlet />
      </main>

      <nav className="agri-mshell-tabbar">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `agri-mshell-tab${isActive ? " active" : ""}`}>
            {({ isActive }) => (
              <>
                <span className={`agri-mshell-tab-icon${isActive ? " active" : ""}`}>
                  <Icon size={19} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button className="agri-mshell-tab" onClick={() => setPanel("more")}>
          <span className={`agri-mshell-tab-icon${panel === "more" ? " active" : ""}`}>
            <Package size={19} />
          </span>
          More
        </button>
      </nav>

      {panel === "more" && (
        <div className="agri-mshell-sheet">
          <div className="agri-mshell-sheet-header">
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>More</div>
            <button className="agri-mshell-close" onClick={() => setPanel(null)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="agri-mshell-sheet-body">
            <div className="agri-mshell-profile">
              <div className="agri-mshell-avatar">
                <UserIcon size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{user?.name ?? "Admin"}</div>
                <div className="agri-muted" style={{ fontSize: "0.75rem" }}>{role}</div>
              </div>
            </div>

            <div className="agri-mshell-list">
              {moreItems.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to} className="agri-mshell-list-item" onClick={() => setPanel(null)}>
                  <Icon size={17} color="var(--agri-primary-dark)" />
                  <span style={{ flex: 1 }}>{label}</span>
                  <ChevronRight size={15} color="#c3ccc5" />
                </Link>
              ))}
            </div>

            <button className="agri-mshell-logout" onClick={handleLogout}>
              <LogOut size={16} />
              Log Out
            </button>
          </div>
        </div>
      )}

      {panel === "notif" && (
        <div className="agri-mshell-sheet">
          <div className="agri-mshell-sheet-header">
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Notifications</div>
            <button className="agri-mshell-close" onClick={() => setPanel(null)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="agri-mshell-sheet-body">
            {unreadCount > 0 && (
              <button className="btn btn-link p-0 agri-mshell-markread" onClick={() => setReadIds(new Set(notifications.map((n) => n.id)))}>
                Mark all as read
              </button>
            )}
            {notifications.length === 0 && <div className="agri-muted" style={{ fontSize: "0.85rem" }}>No recent activity.</div>}
            {notifications.map((n) => (
              <div key={n.id} className="agri-mshell-notif">
                {!readIds.has(n.id) && <span className="agri-submission-dot" style={{ position: "static", marginTop: 5, flexShrink: 0 }} />}
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: readIds.has(n.id) ? 400 : 700 }}>{n.title}</div>
                  <div className="agri-muted" style={{ fontSize: "0.75rem" }}>{n.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

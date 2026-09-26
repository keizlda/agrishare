import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Calendar,
  ChevronDown,
  LogOut,
  Menu,
  User as UserIcon,
  Users,
  ShieldCheck,
  Truck,
  Inbox,
  Megaphone,
  FileBarChart2,
  Star,
  Settings,
  Sprout,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import ProfileModal from "../ui/ProfileModal.jsx";
import NotificationBell from "./NotificationBell.jsx";

// `roles` gates visibility per the Use Case Diagram: MAO Admin gets every
// module; FA President is limited to viewing farmers/distributions (no
// registration, validation workflow, reporting, commodity management, or
// system settings). Dashboard is reached via the logo, not a nav item;
// Settings lives in the Admin menu, not the nav bar.
const NAV_ITEMS = [
  { to: "/farmers", label: "Farmers", icon: Users, roles: ["MAO Admin", "FA President"] },
  { to: "/validation", label: "Validation", icon: ShieldCheck, roles: ["MAO Admin"] },
  { to: "/distributions", label: "Distributions", icon: Truck, roles: ["MAO Admin", "FA President"] },
  { to: "/requests", label: "Requests", icon: Inbox, roles: ["MAO Admin", "FA President"] },
  { to: "/reports", label: "Reports", icon: FileBarChart2, roles: ["MAO Admin"] },
  { to: "/commodities", label: "Commodities", icon: Star, roles: ["MAO Admin"] },
];

const today = new Date().toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "MAO Admin";
  const isMAO = role === "MAO Admin";
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const [openMenu, setOpenMenu] = useState(null); // "bell" | "avatar" | null
  const [showProfile, setShowProfile] = useState(false);
  const ref = useRef(null);

  useEscapeToClose(openMenu !== null, () => setOpenMenu(null));

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpenMenu(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <header className="agri-topbar" ref={ref}>
      <div className="agri-topbar-row">
        <button
          className="agri-icon-btn agri-nav-toggle"
          onClick={() => setOpenMenu(openMenu === "mobile-nav" ? null : "mobile-nav")}
          aria-label={openMenu === "mobile-nav" ? "Close menu" : "Open menu"}
          aria-expanded={openMenu === "mobile-nav"}
        >
          {openMenu === "mobile-nav" ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link to="/" className="agri-logo">
          <Sprout size={22} color="var(--agri-primary)" />
          <span>AGRI<em>SHARE</em></span>
        </Link>

        <nav className="agri-topnav">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `agri-topnav-link${isActive ? " active" : ""}`}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {openMenu === "mobile-nav" && (
          <nav className="agri-mobile-nav">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpenMenu(null)}
                className={({ isActive }) => `agri-mobile-nav-link${isActive ? " active" : ""}`}
              >
                <Icon size={17} />
                {label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="agri-topbar-right">
          <div className="agri-date-pill" title="Today's date">
            <Calendar size={15} />
            {today}
          </div>

          <NotificationBell
            open={openMenu === "bell"}
            onToggle={() => setOpenMenu(openMenu === "bell" ? null : "bell")}
            onClose={() => setOpenMenu(null)}
          />

          <div style={{ position: "relative" }}>
            <button
              onClick={() => setOpenMenu(openMenu === "avatar" ? null : "avatar")}
              aria-label="Account menu"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none" }}
            >
              <div className="agri-avatar">
                <UserIcon size={18} />
              </div>
              <span className="agri-avatar-name" style={{ fontSize: "0.85rem", fontWeight: 600 }}>{user?.name ?? "Admin"}</span>
              <ChevronDown size={15} color="#899489" />
            </button>
            {openMenu === "avatar" && (
              <div
                className="agri-card"
                style={{ position: "absolute", right: 0, top: 44, width: 190, padding: 6, zIndex: 20 }}
              >
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--agri-border)" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{user?.name ?? "Admin"}</div>
                  <div className="agri-muted" style={{ fontSize: "0.72rem" }}>{user?.role ?? "MAO Admin"}</div>
                </div>
                <button
                  onClick={() => { setOpenMenu(null); setShowProfile(true); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px",
                    background: "none", border: "none", color: "var(--agri-text)", fontSize: "0.85rem", borderRadius: 8,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--agri-primary-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <UserIcon size={15} /> Profile
                </button>
                {isMAO && (
                  <button
                    onClick={() => { setOpenMenu(null); navigate("/announcements"); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px",
                      background: "none", border: "none", color: "var(--agri-text)", fontSize: "0.85rem", borderRadius: 8,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--agri-primary-soft)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <Megaphone size={15} /> Announcements
                  </button>
                )}
                {isMAO && (
                  <button
                    onClick={() => { setOpenMenu(null); navigate("/settings"); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px",
                      background: "none", border: "none", color: "var(--agri-text)", fontSize: "0.85rem", borderRadius: 8,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--agri-primary-soft)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <Settings size={15} /> Settings
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px",
                    background: "none", border: "none", color: "var(--agri-red)", fontSize: "0.85rem", borderRadius: 8,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--agri-red-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <LogOut size={15} /> Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showProfile && <ProfileModal user={user} onClose={() => setShowProfile(false)} />}
    </header>
  );
}

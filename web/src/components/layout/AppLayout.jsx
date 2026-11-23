import { Navigate, Outlet, useLocation } from "react-router-dom";
import { RotateCw, WifiOff } from "lucide-react";
import Topbar from "./Topbar.jsx";
import MobileShell from "./MobileShell.jsx";
import ErrorBoundary from "../ui/ErrorBoundary.jsx";
import Toast from "../ui/Toast.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useIsMobile } from "../../hooks/useIsMobile.js";

// Mirrors Topbar.jsx's NAV_ITEMS roles — kept as a separate map here since
// the guard needs to run before Topbar even mounts (direct URL entry).
// /settings is reachable by both roles — General Information is MAO-only
// within the page itself, but Change Password is per-user for everyone.
// /announcements is shared too — FA President gets a read-only view there
// with a "Forward to farmers" action (RLS already limits what they can see
// and change; the page itself hides MAO-only controls for that role).
const MAO_ONLY_ROUTES = ["/reports", "/activity-log"];

// Pages that fill the viewport height below the navbar (desktop only — the
// CSS is scoped to >=1024px). Everything else keeps normal page scrolling.
// The Dashboard has its own height-aware fill rules (.agri-app-dash), since
// it falls back to scrolling on short screens rather than always filling.
const FILL_ROUTES = ["/farmers", "/validation", "/distributions", "/requests", "/announcements", "/activity-log"];

export default function AppLayout() {
  const { isAuthenticated, initializing, user, bootError, retryRestore, notice, clearNotice } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  // The page section ("/validation" for /validation/harvest/12): sub-pages
  // fill the screen like their page and keep its state when opened.
  const section = `/${location.pathname.split("/")[1] ?? ""}`;

  if (initializing) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--agri-primary-dark)" }}>
        Loading AgriShare…
      </div>
    );
  }

  // Signed in earlier, but the account couldn't load (offline, server
  // problem): stay signed in and offer a retry rather than bouncing to Login.
  if (bootError) {
    return (
      <div className="agri-crash" style={{ minHeight: "100vh" }} role="alert">
        <div className="agri-card agri-crash-card">
          <div className="agri-crash-icon">
            <WifiOff size={22} />
          </div>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>{bootError}</div>
          <div className="agri-muted" style={{ fontSize: "0.85rem", marginBottom: 18 }}>You're still signed in.</div>
          <button type="button" className="btn btn-agri-primary d-inline-flex align-items-center gap-2" onClick={retryRestore}>
            <RotateCw size={15} /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user?.role === "FA President" && MAO_ONLY_ROUTES.includes(section)) {
    return <Navigate to="/" replace />;
  }

  // Mobile gets its own shell entirely (bottom tabs, app-style navigation)
  // rather than a reflowed version of the desktop one — desktop's branch
  // below is untouched from before this split existed.
  // "You signed in as another account in another tab." after following a
  // sign-in made in another tab.
  const noticeToast = notice && <Toast tone="info" message={notice} duration={6000} onDone={clearNotice} />;

  if (isMobile) {
    return (
      <>
        <MobileShell />
        {noticeToast}
      </>
    );
  }

  return (
    <div
      className={`agri-app${FILL_ROUTES.includes(section) ? " agri-app-fill" : ""}${location.pathname === "/" ? " agri-app-dash" : ""}`}
    >
      <Topbar />
      <div className="agri-content">
        <ErrorBoundary key={section}>
          <Outlet />
        </ErrorBoundary>
      </div>
      {noticeToast}
    </div>
  );
}

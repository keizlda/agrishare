import { Navigate, Outlet, useLocation } from "react-router-dom";
import Topbar from "./Topbar.jsx";
import MobileShell from "./MobileShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useIsMobile } from "../../hooks/useIsMobile.js";

// Mirrors Topbar.jsx's NAV_ITEMS roles — kept as a separate map here since
// the guard needs to run before Topbar even mounts (direct URL entry).
const MAO_ONLY_ROUTES = ["/validation", "/reports", "/commodities", "/settings"];

export default function AppLayout() {
  const { isAuthenticated, initializing, user } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();

  if (initializing) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--agri-primary-dark)" }}>
        Loading AgriShare…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user?.role === "FA President" && MAO_ONLY_ROUTES.includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  // Mobile gets its own shell entirely (bottom tabs, app-style navigation)
  // rather than a reflowed version of the desktop one — desktop's branch
  // below is untouched from before this split existed.
  if (isMobile) {
    return <MobileShell />;
  }

  return (
    <div className="agri-app">
      <Topbar />
      <div className="agri-content">
        <Outlet />
      </div>
    </div>
  );
}

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";

// For pages outside AppLayout (the print pages, opened in their own tab):
// signed-out visitors go to Login, and a signed-in role that isn't listed
// goes to the Dashboard — the same rules AppLayout applies to its pages.
export default function RequireRole({ roles, children }) {
  const { isAuthenticated, initializing, user, bootError } = useAuth();
  const location = useLocation();

  if (initializing) return <div className="pr-page">Loading…</div>;
  if (bootError) return <div className="pr-page" role="alert">{bootError}</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

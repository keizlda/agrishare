import { Link, useLocation } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";

// "You're using a temporary password" for an account made with one (a new
// Farmers' Association President, or after "New password"), until they
// change it in Settings. Not shown on Settings itself (the form is there).
export default function PasswordReminder() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user?.mustChangePassword || pathname.startsWith("/settings")) return null;
  return (
    <div className="agri-warning-box agri-password-reminder" role="status">
      <KeyRound size={16} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>You&apos;re using a temporary password. Change it to keep your account secure.</div>
      <Link to="/settings" className="btn btn-sm btn-agri-primary">Change Password</Link>
    </div>
  );
}

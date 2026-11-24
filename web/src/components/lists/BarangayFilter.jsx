import { MapPin } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";

// The barangay filter on the list pages: "All barangays", then each barangay
// on the list (Settings → Lists). `value` is "all" or a barangay id. A
// Farmers' Association President only ever sees their own barangay, so they
// get a fixed label instead.
export default function BarangayFilter({ barangays, value, onChange, className = "agri-toolbar-filter", width = 172 }) {
  const { user } = useAuth();
  if (user?.role === "FA President") {
    return (
      <span className={`agri-barangay-fixed ${className}`} style={{ "--agri-filter-width": `${width}px` }} title="Your barangay">
        <MapPin size={14} aria-hidden="true" />
        <span className="agri-barangay-fixed-name">Barangay {user.barangayName || "—"}</span>
      </span>
    );
  }
  return (
    <select
      className={`form-select ${className}`}
      style={{ "--agri-filter-width": `${width}px` }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by barangay"
    >
      <option value="all">All barangays</option>
      {barangays.map((b) => (
        <option key={b.id} value={String(b.id)}>{b.name}{b.isActive ? "" : " (deactivated)"}</option>
      ))}
    </select>
  );
}

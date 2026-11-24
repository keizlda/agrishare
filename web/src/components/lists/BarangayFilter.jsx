// The barangay filter on the list pages: "All barangays", then each barangay
// on the list (Settings → Lists). `value` is "all" or a barangay id.
export default function BarangayFilter({ barangays, value, onChange, className = "agri-toolbar-filter", width = 172 }) {
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

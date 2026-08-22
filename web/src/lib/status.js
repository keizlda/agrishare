// Postgres enums use snake_case ('not_validated'); the UI (built before the
// backend existed) uses Title Case labels ('Not Validated'). Converting at
// the API boundary keeps every page's existing status checks/Pill props
// working unchanged.
export function dbStatusToLabel(value) {
  return value
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function labelToDbStatus(label) {
  return label.trim().toLowerCase().replace(/\s+/g, "_");
}

// Quantities carry their commodity's unit (kg, set, L…) and are only added
// up within one unit: "120 kg", or "6,973 kg + 10 set" when a total spans
// commodities measured differently.
export function formatQuantity(qty, unit) {
  return `${Number(qty || 0).toLocaleString()} ${unit || "kg"}`;
}

export function formatItemsTotal(items) {
  const byUnit = new Map();
  for (const i of items ?? []) {
    const unit = i.unit || "kg";
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + Number(i.quantity || 0));
  }
  if (!byUnit.size) return formatQuantity(0, "kg");
  return [...byUnit].map(([unit, qty]) => formatQuantity(qty, unit)).join(" + ");
}

// The one unit every item shares, or null when they differ.
export function sharedUnit(items) {
  const units = new Set((items ?? []).map((i) => i.unit || "kg"));
  return units.size === 1 ? [...units][0] : null;
}

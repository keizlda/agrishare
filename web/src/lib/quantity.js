// Units that can't be split: a farmer gets whole sets, pieces, heads, bags or
// sacks. kg, L and other measured units keep 2 decimals. (The database
// applies the same list: is_whole_unit().)
const WHOLE_UNITS = new Set(["set", "sets", "pc", "pcs", "piece", "pieces", "head", "heads", "bag", "bags", "sack", "sacks", "unit", "units", "pack", "packs"]);
export function isWholeUnit(unit) {
  return WHOLE_UNITS.has(String(unit ?? "").trim().toLowerCase().replace(/\.$/, ""));
}

// Splits `total` equally among `count` farmers in steps of 1 (whole units)
// or 0.01: everyone gets the same share rounded down, and what's left goes
// out one step at a time to the first farmers in the list, so the shares
// always add up to exactly the total (23 sets for 2 → 12 and 11).
export function splitEqually(total, count, unit) {
  if (count <= 0) return [];
  const step = isWholeUnit(unit) ? 1 : 0.01;
  const steps = Math.max(Math.floor(Math.round((Number(total) || 0) * 100) / (step * 100)), 0);
  const share = Math.floor(steps / count);
  const left = steps - share * count;
  return Array.from({ length: count }, (_, i) => Math.round((share + (i < left ? 1 : 0)) * step * 100) / 100);
}

// A quantity typed with decimals for a unit that can't be split.
export function isSplitQuantity(value, unit) {
  const n = Number(value);
  return isWholeUnit(unit) && Number.isFinite(n) && !Number.isInteger(n);
}

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

// Allocation by farm size (capstone review, Nov 2026): a farmer's quantity is
// farm size (ha) × the commodity's allocation per hectare, capped at its
// maximum per farmer, rounded to 2 decimals — 1.25 ha × 40 kg/ha = 50 kg.
// Mirrors commodity_allocation() in the database, which checks it again when
// a distribution is saved.
//
// Worked in hundredths (integers) so the result matches the database's
// numeric rounding exactly: 1.15 ha × 0.5 = 0.575 → 0.58 here too. Units that
// can't be split (set, head, bag…) round to a whole number instead.
import { isWholeUnit } from "./quantity.js";

const cents = (n) => Math.round(Number(n) * 100);

export function hasAllocation(commodity) {
  return Number(commodity?.allocationPerHectare) > 0;
}

// The computed quantity, or null when the commodity has no allocation per
// hectare. A farmer with no farm size on record computes to 0.
export function computeAllocation(commodity, farmSize) {
  if (!hasAllocation(commodity)) return null;
  const size = Number(farmSize);
  if (!(size > 0)) return 0;
  const product = cents(size) * cents(commodity.allocationPerHectare); // in 1/10,000ths
  const max = Number(commodity.maxPerFarmer);
  if (isWholeUnit(commodity.unit)) {
    let whole = Math.round(product / 10000);
    if (max > 0) whole = Math.min(whole, Math.floor(max));
    return whole;
  }
  let hundredths = Math.round(product / 100);
  if (max > 0) hundredths = Math.min(hundredths, cents(max));
  return hundredths / 100;
}

// "2.5 bags" (or "1 bag") for a quantity when the commodity has a pack size,
// otherwise "".
export function formatBags(quantity, packSize) {
  const pack = Number(packSize);
  const qty = Number(quantity);
  if (!(pack > 0) || !(qty > 0)) return "";
  const bags = Math.round((qty / pack) * 100) / 100;
  return `${bags.toLocaleString()} ${bags === 1 ? "bag" : "bags"}`;
}

// "50 kg (2.5 bags)", or "50 kg" without a pack size.
export function formatWithBags(quantity, unit, packSize) {
  const bags = formatBags(quantity, packSize);
  const base = `${Number(quantity || 0).toLocaleString()} ${unit || "kg"}`;
  return bags ? `${base} (${bags})` : base;
}

// "1.25 ha", or "—" when unknown.
export function formatHectares(size) {
  const n = Number(size);
  return n > 0 ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha` : "—";
}

// One line describing a commodity's allocation rule, for the form and the
// Commodities page: "40 kg/ha · 20 kg per bag · up to 60 kg per farmer".
export function describeAllocation(commodity) {
  if (!hasAllocation(commodity)) return "";
  const unit = commodity.unit || "kg";
  const parts = [`${Number(commodity.allocationPerHectare).toLocaleString()} ${unit}/ha`];
  if (Number(commodity.packSize) > 0) parts.push(`${Number(commodity.packSize).toLocaleString()} ${unit} per bag`);
  if (Number(commodity.maxPerFarmer) > 0) parts.push(`up to ${Number(commodity.maxPerFarmer).toLocaleString()} ${unit} per farmer`);
  return parts.join(" · ");
}

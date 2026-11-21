// Allocation by hectare (MAO presentation, Nov 2026): a commodity measured
// in kg can have types, each with its own rate in kg per hectare (e.g. Rice
// Seeds: Inbred (RCEF) 40 kg/ha, Hybrid 15 kg/ha). A farmer's quantity is
// farm size × their type's rate, in kg, rounded to 2 decimals —
// 2 ha × 15 kg/ha = 30 kg. Types and rates come from the database (managed
// on the Commodities page); nothing here knows any commodity or type.
//
// Worked in hundredths (integers) so the result matches the database's
// round(size × rate, 2) exactly.
const cents = (n) => Math.round(Number(n) * 100);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The commodity's active types, the default first.
export function activeTypes(commodity) {
  return [...(commodity?.types ?? [])].filter((t) => !t.removed).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id);
}

export function hasTypes(commodity) {
  return activeTypes(commodity).length > 0;
}

// The type to use when none is chosen: the default, else the first.
export function defaultType(commodity) {
  return activeTypes(commodity)[0] ?? null;
}

// farm size × rate (kg, 2 decimals); null without a rate, 0 without a farm size.
export function computeAllocation(rate, farmSize) {
  if (!(Number(rate) > 0)) return null;
  if (!(Number(farmSize) > 0)) return 0;
  return Math.round((cents(farmSize) * cents(rate)) / 100) / 100;
}

// "2.00 ha × 15 kg/ha"
export function describeCalculation(farmSize, rate) {
  return `${Number(farmSize || 0).toFixed(2)} ha × ${Number(rate).toLocaleString()} kg/ha`;
}

// "1,250 kg"
export function formatKg(n) {
  return `${round2(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`;
}

// "Inbred (RCEF) 40 · Hybrid 15 kg/ha", or "—".
export function describeRates(commodity) {
  const types = activeTypes(commodity);
  if (!types.length) return "—";
  return `${types.map((t) => `${t.name} ${Number(t.rate).toLocaleString()}`).join(" · ")} kg/ha`;
}

// "1.25 ha", or "—" when unknown.
export function formatHectares(size) {
  const n = Number(size);
  return n > 0 ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha` : "—";
}

// Allocation by hectare: each commodity measured in kg can have one rate,
// in kg per hectare (commodities.allocation_per_hectare, set by the MAO
// Admin on the Commodities page). Varieties are separate commodities, e.g.
// "Rice Seeds – Inbred (RCEF)" 40 kg/ha and "Rice Seeds – Hybrid" 15 kg/ha.
// A farmer's quantity is farm size × the commodity's rate, in kg, rounded to
// 2 decimals — 2 ha × 15 kg/ha = 30 kg.
//
// Worked in hundredths (integers) so the result matches the database's
// round(size × rate, 2) exactly.
const cents = (n) => Math.round(Number(n) * 100);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

// "40 kg/ha", or "—" when the commodity has no rate.
export function formatRate(rate) {
  return Number(rate) > 0 ? `${Number(rate).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/ha` : "—";
}

// "1.25 ha", or "—" when unknown.
export function formatHectares(size) {
  const n = Number(size);
  return n > 0 ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha` : "—";
}

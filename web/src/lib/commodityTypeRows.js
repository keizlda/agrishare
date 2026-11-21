// Rows of the "Types and rates" editor (Commodities page): building them from
// a commodity, checking them, and turning them into what saveCommodity takes.
let nextKey = 1;
export const newTypeKey = () => `new-${nextKey++}`;

// Editable rows from a commodity's types (or none for a new commodity).
export function typeRowsFor(commodity) {
  return (commodity?.types ?? []).map((t) => ({ key: `t-${t.id}`, id: t.id, name: t.name, rate: String(t.rate), isDefault: t.isDefault, removed: false }));
}

// The same rules the database checks: name required and unique per
// commodity; rate above 0, up to 1,000 kg/ha, at most 2 decimals; one
// default. Returns { [rowKey]: { name?, rate? } } plus `_form` for list-wide
// problems.
export function validateTypeRows(rows) {
  const errors = {};
  const seen = new Map();
  for (const r of rows.filter((x) => !x.removed)) {
    const e = {};
    const name = r.name.trim().replace(/\s+/g, " ");
    if (!name) e.name = "Enter a name.";
    else if (name.length > 60) e.name = "Keep it to 60 characters.";
    else if (seen.has(name.toLowerCase())) e.name = "Already used for this commodity.";
    seen.set(name.toLowerCase(), true);
    const t = String(r.rate).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(t) || !(Number(t) > 0)) e.rate = "Enter a rate above 0 (up to 2 decimals).";
    else if (Number(t) > 1000) e.rate = "Keep it to 1,000 kg/ha or less.";
    if (Object.keys(e).length) errors[r.key] = e;
  }
  return errors;
}

// Rows ready for saveCommodity: trimmed names, one default (the first row
// when none is marked).
export function typeRowsToSave(rows) {
  const live = rows.filter((r) => !r.removed);
  const hasDefault = live.some((r) => r.isDefault);
  return rows
    .filter((r) => r.id || !r.removed)
    .map((r) => ({ id: r.id, name: r.name.trim().replace(/\s+/g, " "), rate: String(r.rate).trim(), isDefault: !r.removed && (r.isDefault || (!hasDefault && r === live[0])), removed: r.removed }));
}


// Units that can't be split: a farmer asks for whole sets, pieces, heads,
// bags or sacks. kg, L and other measured units allow 2 decimals. (Same list
// as the web app and the database's is_whole_unit().)
const WHOLE_UNITS = new Set(["set", "sets", "pc", "pcs", "piece", "pieces", "head", "heads", "bag", "bags", "sack", "sacks", "unit", "units", "pack", "packs"]);

export function isWholeUnit(unit) {
  return WHOLE_UNITS.has(String(unit ?? "").trim().toLowerCase().replace(/\.$/, ""));
}

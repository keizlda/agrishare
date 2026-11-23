// Shared by the distribution form's commodity picker and the Manage
// commodities window: the same rules the database checks
// (commodity_rate_guard), as plain messages per field.
export const isKg = (unit) => String(unit ?? "").trim().toLowerCase() === "kg";
export const MAX_NAME_LENGTH = 80;
export const MAX_RATE = 1000;
export const RATE_HINT = "Leave blank for items not given by hectare (quantities are then split equally or entered manually).";
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A rate typed as text: "" (none) or a number above 0, up to 1,000, with at
// most 2 decimals. Returns the message, or "".
export function rateProblem(text, unit = "kg") {
  const rate = String(text ?? "").trim();
  if (!rate) return "";
  if (!isKg(unit)) return "An allocation per hectare is only for commodities measured in kg.";
  if (!/^\d+(\.\d{1,2})?$/.test(rate) || Number(rate) <= 0) return "Enter the kg per hectare as a number above 0, with up to 2 decimals.";
  if (Number(rate) > MAX_RATE) return `Enter up to ${MAX_RATE.toLocaleString()} kg per hectare.`;
  return "";
}

// `others`: the other commodities (for the duplicate-name check).
export function validateCommodity(form, others, unit = "kg") {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Enter the commodity name.";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
  else if (others.some((c) => sameName(c.name, name))) errors.name = "A commodity with this name already exists.";
  if ("category" in form && !String(form.category ?? "").trim()) errors.category = "Choose a category.";
  const rate = rateProblem(form.rate, unit);
  if (rate) errors.rate = rate;
  return errors;
}


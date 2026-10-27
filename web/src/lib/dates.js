// Every date in the system reads Month Day, Year, and every date field is
// typed MM/DD/YYYY. Stored values stay ISO ("2026-10-27" or a full
// timestamp) — these helpers only change how dates are shown and typed.
// Dates are shown in Philippine time, so a timestamp near midnight falls on
// the same day for every viewer.
const TIME_ZONE = "Asia/Manila";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TYPED_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function toDate(value) {
  if (!value) return null;
  // A calendar date has no time of day: noon UTC is that same date in Manila.
  const d = value instanceof Date ? value : new Date(ISO_DATE.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(value, options, fallback) {
  const d = toDate(value);
  if (!d) return value || fallback;
  return d.toLocaleString("en-US", { ...options, timeZone: TIME_ZONE });
}

// "Oct 27, 2026"
export function formatDate(value, fallback = "—") {
  return format(value, { month: "short", day: "numeric", year: "numeric" }, fallback);
}

// "October 27, 2026"
export function formatDateLong(value, fallback = "—") {
  return format(value, { month: "long", day: "numeric", year: "numeric" }, fallback);
}

// "10/27/2026" — for tight printed table columns.
export function formatDateNumeric(value, fallback = "") {
  return format(value, { month: "2-digit", day: "2-digit", year: "numeric" }, fallback);
}

// "Oct 27, 2026, 3:15 PM"
export function formatDateTime(value, fallback = "—") {
  return format(value, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, fallback);
}

// Today in Manila as "2026-10-27".
export function todayIso() {
  const [m, d, y] = formatDateNumeric(new Date()).split("/");
  return `${y}-${m}-${d}`;
}

// "2026-10-27" -> "10/27/2026"
export function isoToTyped(iso) {
  const m = ISO_DATE.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

// Digits only, slashes added while typing: "1027" -> "10/27".
export function maskTypedDate(text) {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

// "10/27/2026" -> "2026-10-27"; null while incomplete or not a real date.
export function typedToIso(text) {
  const m = TYPED_DATE.exec(text ?? "");
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${yyyy}-${mm}-${dd}`;
}

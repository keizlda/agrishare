// Every date in the app reads Month Day, Year ("Oct 27, 2026"), and the
// planting date is typed MM/DD/YYYY — the same as the web system
// (web/src/lib/dates.js). Stored values stay ISO ("2026-10-27" or a full
// timestamp); these helpers only change how dates are shown and typed.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TYPED_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function toDate(value) {
  if (!value) return null;
  const iso = typeof value === "string" ? ISO_DATE.exec(value) : null;
  // A calendar date is that day on the phone's own clock, so it never shifts
  // by a day the way new Date("2026-10-27") (UTC midnight) can.
  const d = value instanceof Date ? value : iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Oct 27, 2026"
export function formatDate(value, fallback = "—") {
  const d = toDate(value);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : value || fallback;
}

// "October 27, 2026"
export function formatDateLong(value, fallback = "—") {
  const d = toDate(value);
  return d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : value || fallback;
}

// "Oct 27, 2026, 3:15 PM"
export function formatDateTime(value, fallback = "—") {
  const d = toDate(value);
  return d
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : value || fallback;
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
  if (day > new Date(year, month, 0).getDate()) return null;
  return `${yyyy}-${mm}-${dd}`;
}

// Today on the phone's clock as "2026-10-27".
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

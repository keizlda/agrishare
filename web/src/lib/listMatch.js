// Name matching for the managed lists (sitios/puroks, farmers' associations,
// crops). The database refuses two names that are the same ignoring case and
// spaces; here we also warn about names that look alike ("Prk. 1" or
// "Purok One" when "Purok 1" exists, "Balulang" when "Sitio Balulang"
// exists), so the same place isn't added twice under another spelling.

// The same ignoring case and spaces (what the database compares).
export const nameKey = (name) => String(name ?? "").toLowerCase().replace(/\s+/g, "");

export const cleanName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");

// Is a record in the chosen barangay? By its barangay id, or (records saved
// before the barangays list) by its barangay text. "all" matches everything.
export function inBarangay(barangays, chosenId, id, text) {
  if (!chosenId || chosenId === "all") return true;
  if (id) return String(id) === String(chosenId);
  const chosen = barangays.find((b) => String(b.id) === String(chosenId));
  return !!chosen && !!text && [chosen.name, ...(chosen.formerNames ?? [])].some((n) => nameKey(n) === nameKey(text));
}

const NUMBER_WORDS = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", uno: "1", dos: "2", tres: "3", kwatro: "4", singko: "5" };
// Words that don't tell two places (or associations) apart.
const FILLER = new Set(["sitio", "so", "purok", "prk", "brgy", "barangay", "the", "of", "and", "association", "assoc", "assn", "inc", "farmers", "farmer", "farmer's", "farmers'"]);

// A looser key: no punctuation, number words as digits, filler words removed.
function looseKey(name) {
  const words = String(name ?? "").toLowerCase().replace(/[.,'’()-]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.map((w) => NUMBER_WORDS[w] ?? w).filter((w) => !FILLER.has(w));
  return (kept.length ? kept : words).join("");
}

function distance(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// The entry with exactly this name (ignoring case and spaces), if any.
export function findSame(entries, name, exceptId = null) {
  const k = nameKey(name);
  return k ? entries.find((e) => e.id !== exceptId && nameKey(e.name) === k) ?? null : null;
}

// An entry whose name looks like this one, if any.
export function findSimilar(entries, name, exceptId = null) {
  const loose = looseKey(name);
  if (!loose) return null;
  let best = null;
  for (const e of entries) {
    if (e.id === exceptId) continue;
    const other = looseKey(e.name);
    if (!other) continue;
    const d = distance(loose, other);
    const allowed = Math.min(loose.length, other.length) >= 6 ? 2 : Math.min(loose.length, other.length) >= 4 ? 1 : 0;
    const contained = Math.min(loose.length, other.length) >= 4 && (loose.includes(other) || other.includes(loose));
    if (d <= allowed || contained) {
      if (!best || d < best.d) best = { entry: e, d };
    }
  }
  return best?.entry ?? null;
}

// The list entry an older free-text value stands for (same ignoring case
// and spaces), for records saved before the lists existed.
// The entry a saved text stands for: the same name, or (barangays) a former
// name ("Langapud" is Langapod).
export function entryForText(entries, text) {
  const k = nameKey(text);
  return findSame(entries, text) ?? (k ? entries.find((e) => (e.formerNames ?? []).some((n) => nameKey(n) === k)) ?? null : null);
}

export const MAX_LIST_NAME = 80;

// Checks a new name (or a rename, exceptId = the entry itself):
// { error, same } when it can't be used, { name, similar } when it looks
// like an entry (the caller asks first), or { name } when it's fine.
// anyway: the user already saw the "similar" warning.
export function checkName(entries, raw, { exceptId = null, anyway = false } = {}) {
  const name = cleanName(raw);
  if (!name) return { error: "Enter a name." };
  if (name.length > MAX_LIST_NAME) return { error: `Keep the name to ${MAX_LIST_NAME} characters or fewer.` };
  const same = findSame(entries, name, exceptId);
  if (same) return { error: same.isActive ? `“${same.name}” is already on the list.` : `“${same.name}” is on the list but deactivated.`, same };
  if (!anyway) {
    const similar = findSimilar(entries.filter((e) => e.isActive), name, exceptId);
    if (similar) return { name, similar };
  }
  return { name };
}

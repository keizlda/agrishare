import { supabase } from "../supabaseClient.js";

// Managed lists (see migrations 20261124000300 and 20261124000500):
// sitios/puroks, farmers' associations, crops and barangays. Everyone signed
// in reads them; the MAO Admin and the Farmers' Association President add
// sitios and associations; only the MAO Admin adds crops and barangays,
// renames, deactivates or deletes. Barangays are never deleted (posts and
// farmers point to them), only deactivated.
export const LISTS = {
  sitios: { table: "sitios", title: "Sitios / Puroks", noun: "sitio/purok", addLabel: "Add new sitio/purok", placeholder: "Select sitio/purok" },
  associations: { table: "associations", title: "Farmers' Associations", noun: "farmers' association", addLabel: "Add new association", placeholder: "Select farmers' association" },
  crops: { table: "crop_types", title: "Crops", noun: "commodity/crop", addLabel: "Add new crop", placeholder: "Select commodity" },
  barangays: { table: "barangays", title: "Barangays", noun: "barangay", addLabel: "Add new barangay", placeholder: "Select barangay", noDelete: true },
};
const KINDS = Object.keys(LISTS);

// Sitios/puroks and associations belong to a barangay; a barangay keeps its
// former names (so older text still matches) and, when known, a center.
const SELECT = {
  sitios: "id, name, is_active, created_at, barangay_id",
  associations: "id, name, is_active, created_at, barangay_id",
  crop_types: "id, name, is_active, created_at",
  barangays: "id, name, is_active, created_at, former_names, center_lat, center_lng",
};
const mapEntry = (row) => ({
  id: row.id,
  name: row.name,
  isActive: row.is_active,
  createdAt: row.created_at,
  barangayId: row.barangay_id ?? null,
  formerNames: row.former_names ?? [],
  center: row.center_lat != null && row.center_lng != null ? { lat: Number(row.center_lat), lng: Number(row.center_lng) } : null,
});

export async function listEntries(kind) {
  const { data, error } = await supabase.from(LISTS[kind].table).select(SELECT[LISTS[kind].table]).order("name");
  if (error) throw error;
  return data.map(mapEntry);
}

// All the lists at once: { sitios, associations, crops, barangays }.
export async function listAllEntries() {
  const lists = await Promise.all(KINDS.map(listEntries));
  return Object.fromEntries(KINDS.map((k, i) => [k, lists[i]]));
}

// barangayId: the barangay a new sitio/purok or association belongs to.
export async function addEntry(kind, name, barangayId = null) {
  const table = LISTS[kind].table;
  const { data, error } = await supabase.from(table).insert({ name, ...(barangayId ? { barangay_id: Number(barangayId) } : {}) }).select(SELECT[table]).single();
  if (error) throw error;
  return mapEntry(data);
}

async function updateEntry(kind, id, fields) {
  const { data, error } = await supabase.from(LISTS[kind].table).update(fields).eq("id", id).select(SELECT[LISTS[kind].table]).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only the MAO Admin can change this list.");
  return mapEntry(data);
}

export const renameEntry = (kind, id, name) => updateEntry(kind, id, { name });
export const setEntryActive = (kind, id, isActive) => updateEntry(kind, id, { is_active: isActive });

export async function deleteEntry(kind, id) {
  const { error } = await supabase.from(LISTS[kind].table).delete().eq("id", id);
  if (error) {
    if (/foreign key/i.test(error.message ?? "")) throw new Error("It's used by farmer records, so it can only be deactivated.");
    throw error;
  }
}

// { sitios: { [id]: farmers }, associations: {...}, crops: {...}, barangays: {...} }
export async function listUsage() {
  const { data, error } = await supabase.rpc("list_usage");
  if (error) throw error;
  const out = Object.fromEntries(KINDS.map((k) => [k, {}]));
  const kindOf = Object.fromEntries(KINDS.map((k) => [LISTS[k].table, k]));
  for (const r of data ?? []) if (kindOf[r.list]) out[kindOf[r.list]][r.id] = Number(r.uses);
  return out;
}

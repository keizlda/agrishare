import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

// A commodity with its types and kg/ha rates (commodity_types). Removed
// types stay readable (past distributions and requests keep showing them)
// but are marked `removed` and left out of every choice.
const SELECT = `
  commodity_id, name, category, unit, status, created_at, deleted_at,
  commodity_types ( commodity_type_id, name, rate_kg_per_ha, is_default, deleted_at, updated_at, updater:profiles!updated_by ( full_name ) )
`;

function mapType(t) {
  return {
    id: t.commodity_type_id,
    name: t.name,
    rate: Number(t.rate_kg_per_ha),
    isDefault: !!t.is_default,
    removed: !!t.deleted_at,
    updatedAt: t.updated_at,
    updatedBy: t.updater?.full_name ?? null,
  };
}

function mapCommodity(row) {
  const all = (row.commodity_types ?? []).map(mapType);
  const types = all.filter((t) => !t.removed).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id);
  // "Last updated [date] by [name]": the most recent change to any type.
  const latest = [...all].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0] ?? null;
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
    dateAdded: row.created_at,
    deletedAt: row.deleted_at,
    types,
    allTypes: all,
    typesUpdatedAt: latest?.updatedAt ?? null,
    typesUpdatedBy: latest?.updatedBy ?? null,
  };
}

// Every picker/listing (this page, dropdowns, the New Distribution item
// picker, dashboard widgets) goes through this one function, so filtering
// deleted_at here is what "hidden everywhere" actually means — soft-deleted
// rows stay fully readable (RLS is unchanged) so joins from old distribution
// items/claims/requests can still resolve a deleted commodity's name.
// includeDeleted is for the one place that needs the opposite: a printed
// report totaling historical distributions per commodity, which must keep
// showing a since-deleted commodity's row.
export async function listCommodities({ includeDeleted = false } = {}) {
  let query = supabase.from("commodities").select(SELECT);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapCommodity);
}

async function readCommodity(id) {
  const { data, error } = await supabase.from("commodities").select(SELECT).eq("commodity_id", id).single();
  if (error) throw error;
  return mapCommodity(data);
}

// Adds or edits a commodity together with its types and rates, in one
// database transaction (save_commodity: MAO Admin only). `types` rows:
// { id?, name, rate, isDefault, removed? }; pass null to leave types alone.
export async function saveCommodity(commodityId, { name, category, unit, status }, types) {
  const { data, error } = await supabase.rpc("save_commodity", {
    p_commodity_id: commodityId ?? null,
    p_commodity: { name, category, unit: unit ?? "kg", status: status ? labelToDbStatus(status) : null },
    p_types: types
      ? types.map((t) => ({ id: t.id ?? null, name: t.name, rate: t.rate === "" ? null : Number(t.rate), is_default: !!t.isDefault, removed: !!t.removed }))
      : null,
  });
  if (error) throw error;
  return readCommodity(data);
}

export async function setCommodityStatus(commodityId, statusLabel) {
  const { error } = await supabase.from("commodities").update({ status: labelToDbStatus(statusLabel) }).eq("commodity_id", commodityId);
  if (error) throw error;
}

// Soft delete: sets deleted_at instead of removing the row, so distribution
// items/claims/requests that reference this commodity keep a real row to
// join against — old records and printed reports keep showing its name.
// RLS ("commodities: MAO writes", for all -> mao_admin) already restricts
// this UPDATE to admins; a blocked write (FA President) comes back empty.
export async function deleteCommodity(commodityId) {
  const { data, error } = await supabase
    .from("commodities")
    .update({ deleted_at: new Date().toISOString() })
    .eq("commodity_id", commodityId)
    .select("commodity_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't delete this commodity — refresh and try again.");
}

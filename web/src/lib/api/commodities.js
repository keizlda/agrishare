import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

const numberOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function mapCommodity(row) {
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
    dateAdded: row.created_at,
    deletedAt: row.deleted_at,
    // Allocation by farm size (all optional): quantity per hectare, quantity
    // per bag, and a cap per farmer — see lib/allocation.js.
    allocationPerHectare: numberOrNull(row.allocation_per_hectare),
    packSize: numberOrNull(row.pack_size),
    maxPerFarmer: numberOrNull(row.max_per_farmer),
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
  let query = supabase.from("commodities").select("*");
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapCommodity);
}

export async function createCommodity({ name, category }) {
  const { data, error } = await supabase.from("commodities").insert({ name, category }).select("*").single();
  if (error) throw error;
  return mapCommodity(data);
}

export async function setCommodityStatus(commodityId, statusLabel) {
  const { error } = await supabase.from("commodities").update({ status: labelToDbStatus(statusLabel) }).eq("commodity_id", commodityId);
  if (error) throw error;
}

// unit, status and the allocation fields are optional (the Commodity Details
// card's inline edit sends them; anything left out is unchanged, and null
// clears an allocation field).
export async function updateCommodity(commodityId, { name, category, unit, status, allocationPerHectare, packSize, maxPerFarmer }) {
  const patch = { name, category };
  if (unit !== undefined) patch.unit = unit;
  if (status !== undefined) patch.status = labelToDbStatus(status);
  if (allocationPerHectare !== undefined) patch.allocation_per_hectare = allocationPerHectare;
  if (packSize !== undefined) patch.pack_size = packSize;
  if (maxPerFarmer !== undefined) patch.max_per_farmer = maxPerFarmer;
  const { data, error } = await supabase
    .from("commodities")
    .update(patch)
    .eq("commodity_id", commodityId)
    .select("*")
    .single();
  if (error) throw error;
  return mapCommodity(data);
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

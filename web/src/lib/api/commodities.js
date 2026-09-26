import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

function mapCommodity(row) {
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
    dateAdded: row.created_at?.slice(0, 10),
  };
}

export async function listCommodities() {
  const { data, error } = await supabase.from("commodities").select("*").order("created_at", { ascending: false });
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

export async function updateCommodity(commodityId, { name, category }) {
  const { data, error } = await supabase
    .from("commodities")
    .update({ name, category })
    .eq("commodity_id", commodityId)
    .select("*")
    .single();
  if (error) throw error;
  return mapCommodity(data);
}

// How many (not-deleted) distributions include this commodity. Used to block
// a delete with a specific message before it's even attempted.
export async function countCommodityDistributions(commodityId) {
  const { count, error } = await supabase
    .from("distribution_event_items")
    .select("event_id, distribution_events!inner(is_deleted)", { count: "exact", head: true })
    .eq("commodity_id", commodityId)
    .eq("distribution_events.is_deleted", false);
  if (error) throw error;
  return count ?? 0;
}

const IN_USE_MESSAGE = "This commodity is used in existing records and can't be deleted. Set it to Inactive instead.";

// The foreign keys from distribution items / claims / requests are
// ON DELETE RESTRICT, so Postgres (23503) refuses even if the UI check above
// was bypassed or missed something (e.g. a soft-deleted distribution). RLS
// limits deleting to mao_admin; a blocked row comes back empty.
export async function deleteCommodity(commodityId) {
  const { data, error } = await supabase.from("commodities").delete().eq("commodity_id", commodityId).select("commodity_id").maybeSingle();
  if (error) {
    if (error.code === "23503") throw new Error(IN_USE_MESSAGE);
    throw error;
  }
  if (!data) throw new Error("Couldn't delete this commodity — refresh and try again.");
}

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

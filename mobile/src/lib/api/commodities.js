import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

function mapCommodity(row) {
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
  };
}

export async function listCommodities() {
  const { data, error } = await supabase.from("commodities").select("*").order("name");
  if (error) throw error;
  return data.map(mapCommodity);
}

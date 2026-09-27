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

// Excludes soft-deleted commodities (web's admin Delete action sets
// deleted_at) — a deleted commodity must not appear in any farmer-facing
// list or picker, but stays readable via joins from the farmer's own past
// requests, so their history still shows its name.
export async function listCommodities() {
  const { data, error } = await supabase.from("commodities").select("*").is("deleted_at", null).order("name");
  if (error) throw error;
  return data.map(mapCommodity);
}

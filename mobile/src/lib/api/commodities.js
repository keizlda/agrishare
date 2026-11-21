import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

// A commodity with its active types and kg-per-hectare rates (managed by the
// MAO Admin on the web), the default type first.
function mapCommodity(row) {
  const types = (row.commodity_types ?? [])
    .filter((t) => !t.deleted_at)
    .map((t) => ({ id: t.commodity_type_id, name: t.name, rate: Number(t.rate_kg_per_ha), isDefault: !!t.is_default }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id);
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
    types,
  };
}

// Excludes soft-deleted commodities (web's admin Delete action sets
// deleted_at) — a deleted commodity must not appear in any farmer-facing
// list or picker, but stays readable via joins from the farmer's own past
// requests, so their history still shows its name.
export async function listCommodities() {
  const { data, error } = await supabase
    .from("commodities")
    .select("commodity_id, name, category, unit, status, commodity_types ( commodity_type_id, name, rate_kg_per_ha, is_default, deleted_at )")
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return data.map(mapCommodity);
}

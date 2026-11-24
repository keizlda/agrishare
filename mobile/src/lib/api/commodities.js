import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

// A commodity with its one kg-per-hectare rate (managed by the MAO Admin on
// the web; null when it isn't given by hectare). Varieties are separate
// commodities, e.g. "Rice Seeds – Inbred (RCEF)" and "Rice Seeds – Hybrid".
function mapCommodity(row) {
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
    rate: row.unit === "kg" && Number(row.allocation_per_hectare) > 0 ? Number(row.allocation_per_hectare) : null,
    // The type of farmer it's for (e.g. Corn Seeds → Corn farmer), or null.
    farmerTypeId: row.farmer_type_id ?? null,
  };
}

// Excludes soft-deleted commodities (web's admin Delete action sets
// deleted_at) — a deleted commodity must not appear in any farmer-facing
// list or picker, but stays readable via joins from the farmer's own past
// requests, so their history still shows its name.
export async function listCommodities() {
  const { data, error } = await supabase
    .from("commodities")
    .select("commodity_id, name, category, unit, status, allocation_per_hectare, farmer_type_id")
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return data.map(mapCommodity);
}

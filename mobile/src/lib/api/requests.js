import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

const SELECT = `
  request_id, quantity_requested, reason, status, created_at, forwarded_to_admin_at,
  commodities ( name, unit )
`;

// What the farmer sees: Pending -> Endorsed (by the Farmers' Association
// President) -> Approved or Rejected (by the MAO), or Not endorsed when the
// Farmers' Association President turned it down. forwarded_to_admin_at is
// only set on endorsement, so it tells the two kinds of rejection apart.
function statusLabel(row) {
  if (row.status === "forwarded") return "Endorsed";
  if (row.status === "rejected") return row.forwarded_to_admin_at ? "Rejected" : "Not endorsed";
  return dbStatusToLabel(row.status);
}

function mapRequest(row) {
  return {
    id: row.request_id,
    commodity: row.commodities?.name ?? "",
    quantity: Number(row.quantity_requested),
    unit: row.commodities?.unit ?? "kg",
    reason: row.reason ?? "",
    requestDate: row.created_at,
    status: statusLabel(row),
  };
}

export async function listMyRequests() {
  const { data, error } = await supabase.from("requests").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapRequest);
}

export async function createRequest({ farmerId, commodityId, quantity, reason }) {
  const { data, error } = await supabase
    .from("requests")
    .insert({ farmer_id: farmerId, commodity_id: commodityId, quantity_requested: Number(quantity) || 0, reason })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRequest(data);
}

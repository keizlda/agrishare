import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

const SELECT = `
  request_id, quantity_requested, reason, status, created_at,
  commodities ( name, unit )
`;

function mapRequest(row) {
  return {
    id: row.request_id,
    commodity: row.commodities?.name ?? "",
    quantity: Number(row.quantity_requested),
    unit: row.commodities?.unit ?? "kg",
    reason: row.reason ?? "",
    requestDate: row.created_at?.slice(0, 10),
    status: dbStatusToLabel(row.status),
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

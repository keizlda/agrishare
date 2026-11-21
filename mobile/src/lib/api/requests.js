import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

const SELECT = `
  request_id, quantity_requested, reason, status, created_at, filed_by, mao_remarks, fa_recommended,
  commodities ( name, unit ), commodity_types ( name )
`;

// What the farmer sees: Pending → Approved or Rejected (by the MAO Admin).
// Requests go straight to the MAO; the Farmers' Association President can
// see them too and may recommend them.
function statusLabel(row) {
  return row.status === "forwarded" ? "Pending" : dbStatusToLabel(row.status);
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
    typeName: row.commodity_types?.name ?? "",
    maoRemarks: row.mao_remarks ?? "",
    recommended: !!row.fa_recommended,
    // Filed for this farmer by their Farmers' Association President.
    filedByFa: !!row.filed_by,
  };
}

export async function listMyRequests() {
  const { data, error } = await supabase.from("requests").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapRequest);
}

export async function createRequest({ farmerId, commodityId, typeId = null, quantity, reason }) {
  const { data, error } = await supabase
    .from("requests")
    .insert({ farmer_id: farmerId, commodity_id: commodityId, commodity_type_id: typeId, quantity_requested: Number(quantity) || 0, reason })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRequest(data);
}

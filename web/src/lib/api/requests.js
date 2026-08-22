import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

const SELECT = `
  request_id, quantity_requested, reason, status, fa_remarks, mao_remarks, created_at,
  farmers ( farmer_id, first_name, surname, rsbsa_no, addresses ( barangay ) ),
  commodities ( name, unit )
`;

function mapRequest(row) {
  return {
    id: row.request_id,
    farmerId: row.farmers?.farmer_id,
    farmerName: `${row.farmers?.first_name ?? ""} ${row.farmers?.surname ?? ""}`.trim(),
    rsbsaNo: row.farmers?.rsbsa_no ?? "",
    barangay: row.farmers?.addresses?.[0]?.barangay ?? "Langapud",
    commodity: row.commodities?.name ?? "",
    quantity: Number(row.quantity_requested),
    unit: row.commodities?.unit ?? "kg",
    reason: row.reason ?? "",
    requestDate: row.created_at?.slice(0, 10),
    status: dbStatusToLabel(row.status),
    faRemarks: row.fa_remarks ?? "",
    maoRemarks: row.mao_remarks ?? "",
  };
}

export async function listRequests() {
  const { data, error } = await supabase.from("requests").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapRequest);
}

// `patch` mirrors what Requests.jsx already passes: { status: "Forwarded", faRemarks }
// or { status: "Approved", maoRemarks }, etc. Only the field relevant to the
// caller's stage gets included, matching the fa_president/mao_admin RLS
// policies (each may only write its own remarks column via app convention).
export async function updateRequestStatus(requestId, patch) {
  const dbPatch = { status: labelToDbStatus(patch.status) };
  if (patch.faRemarks !== undefined) dbPatch.fa_remarks = patch.faRemarks;
  if (patch.maoRemarks !== undefined) dbPatch.mao_remarks = patch.maoRemarks;

  const { data, error } = await supabase.from("requests").update(dbPatch).eq("request_id", requestId).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("This request was already updated by someone else — refresh and try again.");
  }
  return mapRequest(data);
}

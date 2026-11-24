import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel } from "../status.js";
import { computeAllocation } from "../allocation.js";
import { farmSummary } from "./farmers.js";

// Farmer requests (MAO presentation, Nov 2026): a request goes straight to
// the MAO Admin — Pending → Approved / Rejected (a reason is required to
// reject). The Farmers' Association President sees every request too and
// may add a remark or mark it "Recommended by Farmers' Association
// President" while it's Pending; that never blocks the MAO Admin. The
// database decides who may change what and stamps who/when itself.

// The suggested quantity is farm size × the commodity's kg/ha rate (one rate
// per commodity, set by the MAO Admin in the distribution form).
const rateFor = (row) => (row.commodities?.unit === "kg" && Number(row.commodities?.allocation_per_hectare) > 0 ? Number(row.commodities.allocation_per_hectare) : null);

const SELECT = `
  request_id, commodity_id, quantity_requested, reason, status, fa_remarks, mao_remarks, created_at,
  reviewed_by_fa, reviewed_by_mao, fa_decision_at, admin_decision_at, filed_by, fa_recommended, fa_recommended_at,
  filer:profiles!filed_by ( full_name ),
  farmers ( farmer_id, first_name, surname, rsbsa_no, addresses ( barangay, barangay_id, street ), farm_parcels ( parcel_id, farm_size_hectares, crops ( crop_type ) ), profiles!profile_id ( avatar_url ) ),
  commodities ( name, unit, allocation_per_hectare ),
  fa:profiles!reviewed_by_fa ( full_name ),
  mao:profiles!reviewed_by_mao ( full_name )
`;

function mapRequest(row) {
  const farm = farmSummary(row.farmers?.farm_parcels);
  const rate = rateFor(row);
  return {
    id: row.request_id,
    farmerId: row.farmers?.farmer_id,
    commodityId: row.commodity_id,
    farmerFirstName: row.farmers?.first_name ?? "",
    farmerLastName: row.farmers?.surname ?? "",
    farmerName: `${row.farmers?.first_name ?? ""} ${row.farmers?.surname ?? ""}`.trim(),
    rsbsaNo: row.farmers?.rsbsa_no ?? "",
    barangay: row.farmers?.addresses?.[0]?.barangay ?? "",
    barangayId: row.farmers?.addresses?.[0]?.barangay_id ?? null,
    sitioPurok: row.farmers?.addresses?.[0]?.street ?? "",
    avatarUrl: row.farmers?.profiles?.avatar_url ?? null,
    farmSize: farm.farmSize,
    cropType: farm.cropType,
    commodity: row.commodities?.name ?? "",
    quantity: Number(row.quantity_requested),
    unit: row.commodities?.unit ?? "kg",
    // The quantity the farmer's farm size calls for (farm size × the
    // commodity's kg/ha rate), when the commodity has a rate.
    allocationPerHectare: rate,
    suggestedQuantity: rate && farm.farmSize > 0 ? computeAllocation(rate, farm.farmSize) : null,
    reason: row.reason ?? "",
    requestDate: row.created_at,
    status: dbStatusToLabel(row.status),
    // The Farmers' Association President's optional recommendation/remark.
    recommended: !!row.fa_recommended,
    recommendedAt: row.fa_recommended_at ?? row.fa_decision_at ?? null,
    faRemarks: row.fa_remarks ?? "",
    faPresidentName: row.fa?.full_name ?? "Farmers' Association President",
    maoRemarks: row.mao_remarks ?? "",
    maoName: row.mao?.full_name ?? "MAO Admin",
    adminDecisionAt: row.admin_decision_at,
    // Filed by the Farmers' Association President for the farmer.
    filedByFa: !!row.filed_by,
    filedByName: row.filer?.full_name ?? "Farmers' Association President",
    // Requests turned down by the Farmers' Association President before the
    // endorsement step was removed (Nov 2026) keep showing who did it.
    rejectedBy: row.status === "rejected" ? (row.reviewed_by_mao ? "admin" : "fa") : null,
    faDecisionAt: row.fa_decision_at,
  };
}

// Every farmer request in every status, newest first (RLS: staff read all;
// a farmer reads their own).
export async function listRequests() {
  const { data, error } = await supabase.from("requests").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapRequest);
}

async function update(requestId, patch, missing) {
  const { data, error } = await supabase.from("requests").update(patch).eq("request_id", requestId).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(missing);
  return mapRequest(data);
}

// MAO Admin: Pending → Approved or Rejected (remarks required to reject).
export function adminReviewRequest(requestId, { decision, notes }) {
  return update(
    requestId,
    { status: decision === "approve" ? "approved" : "rejected", mao_remarks: notes?.trim() || null },
    "This request was already decided by someone else. Refresh and try again.",
  );
}

// Farmers' Association President: recommend (or not) and/or add a remark,
// while the request is Pending.
export function faRecommendRequest(requestId, { recommended, remarks }) {
  return update(
    requestId,
    { fa_recommended: !!recommended, fa_remarks: remarks?.trim() || null },
    "This request was already decided by the MAO. Refresh to see its status.",
  );
}

// The Farmers' Association President files a request for a farmer; the
// database records them as the filer, and the MAO Admin and the farmer are
// notified.
export async function fileRequestForFarmer({ farmerId, commodityId, quantity, reason }) {
  const { data, error } = await supabase
    .from("requests")
    .insert({ farmer_id: farmerId, commodity_id: commodityId, quantity_requested: Number(quantity), reason: reason.trim() })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRequest(data);
}

// The farmer's Pending requests for this commodity — the "already
// requested" warning before filing another.
export async function findOpenRequests(farmerId, commodityId) {
  const { data, error } = await supabase
    .from("requests")
    .select("request_id, status, quantity_requested, created_at")
    .eq("farmer_id", farmerId)
    .eq("commodity_id", commodityId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ id: r.request_id, status: "Pending", quantity: Number(r.quantity_requested), date: r.created_at }));
}

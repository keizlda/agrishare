import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";
import { computeAllocation } from "../allocation.js";
import { farmSummary } from "./farmers.js";

const SELECT = `
  request_id, commodity_id, quantity_requested, reason, status, fa_remarks, mao_remarks, created_at,
  reviewed_by_fa, reviewed_by_mao, forwarded_to_admin_at, fa_decision_at, admin_decision_at, filed_by,
  filer:profiles!filed_by ( full_name ),
  farmers ( farmer_id, first_name, surname, rsbsa_no, addresses ( barangay, street ), farm_parcels ( parcel_id, farm_size_hectares, crops ( crop_type ) ), profiles!profile_id ( avatar_url ) ),
  commodities ( name, unit, allocation_per_hectare, max_per_farmer ),
  fa:profiles!reviewed_by_fa ( full_name ),
  mao:profiles!reviewed_by_mao ( full_name )
`;

function mapRequest(row) {
  const farm = farmSummary(row.farmers?.farm_parcels);
  const commodity = {
    unit: row.commodities?.unit ?? "kg",
    allocationPerHectare: row.commodities?.allocation_per_hectare != null ? Number(row.commodities.allocation_per_hectare) : null,
    maxPerFarmer: row.commodities?.max_per_farmer != null ? Number(row.commodities.max_per_farmer) : null,
  };
  return {
    id: row.request_id,
    farmerId: row.farmers?.farmer_id,
    commodityId: row.commodity_id,
    farmerFirstName: row.farmers?.first_name ?? "",
    farmerLastName: row.farmers?.surname ?? "",
    farmerName: `${row.farmers?.first_name ?? ""} ${row.farmers?.surname ?? ""}`.trim(),
    rsbsaNo: row.farmers?.rsbsa_no ?? "",
    barangay: row.farmers?.addresses?.[0]?.barangay ?? "Langapud",
    sitioPurok: row.farmers?.addresses?.[0]?.street ?? "",
    avatarUrl: row.farmers?.profiles?.avatar_url ?? null,
    farmSize: farm.farmSize,
    cropType: farm.cropType,
    commodity: row.commodities?.name ?? "",
    quantity: Number(row.quantity_requested),
    unit: commodity.unit,
    // The quantity this farmer's farm size calls for (farm size ×
    // allocation per hectare), when the commodity has a rate.
    allocationPerHectare: commodity.allocationPerHectare,
    suggestedQuantity: farm.farmSize > 0 ? computeAllocation(commodity, farm.farmSize) : null,
    reason: row.reason ?? "",
    requestDate: row.created_at,
    status: dbStatusToLabel(row.status),
    faRemarks: row.fa_remarks ?? "",
    maoRemarks: row.mao_remarks ?? "",
    faPresidentName: row.fa?.full_name ?? "Farmers' Association President",
    maoName: row.mao?.full_name ?? "MAO Admin",
    // Filed by the Farmers' Association President for the farmer (it went
    // straight to the MAO as Endorsed).
    filedByFa: !!row.filed_by,
    filedByName: row.filer?.full_name ?? "Farmers' Association President",
    // Present once the FA President has acted; lets the UI tell "I
    // reviewed this" apart from "someone else did" and "rejected by FA
    // before it ever reached Admin" apart from "rejected by Admin".
    reviewedByFa: row.reviewed_by_fa ?? null,
    reviewedByMao: row.reviewed_by_mao ?? null,
    forwardedToAdminAt: row.forwarded_to_admin_at,
    faDecisionAt: row.fa_decision_at,
    adminDecisionAt: row.admin_decision_at,
    // status is only ever "rejected" once, so this is the one place that
    // distinguishes which stage actually rejected it.
    rejectedBy: row.status === "rejected" ? (row.reviewed_by_mao ? "admin" : "fa") : null,
  };
}

// The MAO's review queue and history: every request past the Farmers'
// Association President's review — endorsed (waiting for the MAO), approved,
// rejected, and not endorsed — with the farmer who made it. Read from
// requests directly (RLS: staff read all requests, farmers and profiles).
export async function listRequestsForAdminReview() {
  const { data, error } = await supabase
    .from("requests")
    .select(SELECT)
    .neq("status", "pending")
    .order("fa_decision_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data.map(mapRequest);
}

// FA President's Level 1 decision: Pending -> Forwarded (endorse) or
// Rejected (not endorsed). Sets fa_decision_at (and forwarded_to_admin_at,
// only on endorsement) alongside status so the timeline is accurate from the
// start — RLS still enforces that this can only run on a Pending row and can
// only land on 'forwarded' or 'rejected' (requests: FA forwards or rejects
// pending). The database stamps who decided and when itself
// (request_decision_stamps), whatever is sent here.
export async function faReviewRequest(requestId, { decision, notes }) {
  const { data: auth } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const dbPatch = {
    status: decision === "approve" ? "forwarded" : "rejected",
    fa_remarks: notes ?? null,
    reviewed_by_fa: auth?.user?.id ?? null,
    fa_decision_at: now,
    ...(decision === "approve" ? { forwarded_to_admin_at: now } : {}),
  };
  const { data, error } = await supabase.from("requests").update(dbPatch).eq("request_id", requestId).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This request was already updated by someone else — refresh and try again.");
  return mapRequest(data);
}

// Admin's Level 2 decision: Forwarded -> Approved or Rejected (final).
// RLS enforces this can only run on a Forwarded row (requests: MAO
// approves or rejects forwarded).
export async function adminReviewRequest(requestId, { decision, notes }) {
  const { data: auth } = await supabase.auth.getUser();
  const dbPatch = {
    status: decision === "approve" ? "approved" : "rejected",
    mao_remarks: notes ?? null,
    reviewed_by_mao: auth?.user?.id ?? null,
    admin_decision_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("requests").update(dbPatch).eq("request_id", requestId).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This request was already updated by someone else — refresh and try again.");
  return mapRequest(data);
}

// Every farmer request in every status, newest first. Both the MAO Admin and
// the Farmers' Association President see all of them (RLS: staff read all
// requests); each can only act at their own step.
export async function listRequests() {
  const { data, error } = await supabase.from("requests").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapRequest);
}

// The Farmers' Association President files a request for a farmer. The
// database records them as the filer and endorser and sends it straight to
// the MAO (request_insert_defaults); the farmer and the MAO are notified.
export async function fileRequestForFarmer({ farmerId, commodityId, quantity, reason }) {
  const { data, error } = await supabase
    .from("requests")
    .insert({ farmer_id: farmerId, commodity_id: commodityId, quantity_requested: Number(quantity), reason: reason.trim() })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRequest(data);
}

// The farmer's requests for this commodity that are still open (Pending or
// Endorsed) — the "already requested" warning before filing another.
export async function findOpenRequests(farmerId, commodityId) {
  const { data, error } = await supabase
    .from("requests")
    .select("request_id, status, quantity_requested, created_at")
    .eq("farmer_id", farmerId)
    .eq("commodity_id", commodityId)
    .in("status", ["pending", "forwarded"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ id: r.request_id, status: r.status === "forwarded" ? "Endorsed" : "Pending", quantity: Number(r.quantity_requested), date: r.created_at }));
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

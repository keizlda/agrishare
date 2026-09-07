import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

const SELECT = `
  request_id, quantity_requested, reason, status, fa_remarks, mao_remarks, created_at,
  reviewed_by_fa, reviewed_by_mao, forwarded_to_admin_at, fa_decision_at, admin_decision_at,
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

// Admin's review queue/history: sourced from requests_for_admin_review,
// a view that has no farmer column at all (see the migration) — Admin
// reviews the FA President's judgment, not the farmer's identity.
const ADMIN_VIEW_SELECT = `
  request_id, status, quantity_requested, fa_remarks, mao_remarks, created_at,
  forwarded_to_admin_at, fa_decision_at, admin_decision_at,
  commodity_name, commodity_unit, fa_president_name
`;

function mapAdminReviewRequest(row) {
  return {
    id: row.request_id,
    status: dbStatusToLabel(row.status),
    commodity: row.commodity_name ?? "",
    unit: row.commodity_unit ?? "kg",
    quantity: Number(row.quantity_requested),
    faPresidentName: row.fa_president_name ?? "FA President",
    faRemarks: row.fa_remarks ?? "",
    maoRemarks: row.mao_remarks ?? "",
    requestDate: row.created_at?.slice(0, 10),
    forwardedToAdminAt: row.forwarded_to_admin_at,
    faDecisionAt: row.fa_decision_at,
    adminDecisionAt: row.admin_decision_at,
  };
}

export async function listRequestsForAdminReview() {
  const { data, error } = await supabase
    .from("requests_for_admin_review")
    .select(ADMIN_VIEW_SELECT)
    .order("forwarded_to_admin_at", { ascending: false });
  if (error) throw error;
  return data.map(mapAdminReviewRequest);
}

// FA President's Level 1 decision: Pending -> Forwarded (approve) or
// Rejected. Sets fa_decision_at (and forwarded_to_admin_at, only on
// approval) alongside status so the timeline is accurate from the start —
// RLS still enforces that this can only run on a Pending row and can only
// land on 'forwarded' or 'rejected' (requests: FA forwards or rejects pending).
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

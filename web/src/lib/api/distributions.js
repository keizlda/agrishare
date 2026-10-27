import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";
import { todayIso } from "../dates.js";

const SELECT = `
  event_id, program_name, event_date, venue, barangay, funding_source, status, completed_at, remarks, beneficiaries_count,
  distribution_event_items ( event_item_id, commodity_id, quantity_allocated, commodities ( name, category, unit ) )
`;

function mapDistribution(row, summary) {
  const items = (row.distribution_event_items ?? []).map((i) => ({
    itemId: i.event_item_id,
    commodityId: i.commodity_id,
    name: i.commodities?.name ?? "",
    quantity: Number(i.quantity_allocated),
    unit: i.commodities?.unit ?? "kg",
  }));
  const taggedCount = summary?.tagged_count ?? 0;
  return {
    id: row.event_id,
    date: row.event_date,
    cropType: row.distribution_event_items?.[0]?.commodities?.category ?? "",
    barangay: row.barangay,
    beneficiaries: row.beneficiaries_count,
    taggedBeneficiaryCount: taggedCount,
    // Ongoing or Completed. Each farmer's acknowledgement follows from it
    // (Acknowledged on completedAt) — see lib/distributionStatus.js.
    status: dbStatusToLabel(row.status),
    completedAt: row.completed_at ?? null,
    venue: row.venue ?? "",
    program: row.program_name,
    fundingSource: row.funding_source ?? "",
    remarks: row.remarks ?? "",
    items,
  };
}

// distribution_beneficiary_summary is a view, not embeddable via PostgREST's
// nested select (no FK for it to detect) — fetched alongside and merged by
// event_id instead.
async function fetchSummaries(eventIds) {
  if (eventIds.length === 0) return new Map();
  const { data, error } = await supabase.from("distribution_beneficiary_summary").select("*").in("event_id", eventIds);
  if (error) throw error;
  return new Map(data.map((s) => [s.event_id, s]));
}

export async function listDistributions() {
  const { data, error } = await supabase
    .from("distribution_events")
    .select(SELECT)
    .eq("is_deleted", false)
    .order("event_date", { ascending: false });
  if (error) throw error;
  const summaries = await fetchSummaries(data.map((r) => r.event_id));
  return data.map((row) => mapDistribution(row, summaries.get(row.event_id)));
}

// Single-row fetch for the standalone print view, which loads in its own
// tab (no app state to reuse) and only needs the one distribution. Also
// excludes soft-deleted rows so a deleted distribution can't still be printed.
export async function getDistribution(eventId) {
  const { data, error } = await supabase.from("distribution_events").select(SELECT).eq("event_id", eventId).eq("is_deleted", false).single();
  if (error) throw error;
  const summaries = await fetchSummaries([eventId]);
  return mapDistribution(data, summaries.get(eventId));
}

// ---------------------------------------------------------------------------
// Beneficiary tagging (Phase 2)
// ---------------------------------------------------------------------------
const BENEFICIARY_SELECT = `
  claim_id, farmer_id, quantity_received, duplicate_override_reason,
  farmers ( rsbsa_no, first_name, surname, deleted_at, addresses ( barangay ), profiles!profile_id ( avatar_url ) )
`;

// A deleted farmer's past distribution record is kept (never hidden here —
// see friendlyError.js's sibling rule in the Farmers page for the "hide
// deleted everywhere else" half of this), just flagged so the Distributions
// detail panel can show "(removed)" next to their name.
function mapBeneficiary(row) {
  return {
    claimId: row.claim_id,
    farmerId: row.farmer_id,
    firstName: row.farmers?.first_name ?? "",
    lastName: row.farmers?.surname ?? "",
    rsbsaNo: row.farmers?.rsbsa_no ?? "",
    barangay: row.farmers?.addresses?.[0]?.barangay ?? "Langapud",
    avatarUrl: row.farmers?.profiles?.avatar_url ?? null,
    farmerDeleted: !!row.farmers?.deleted_at,
    quantity: Number(row.quantity_received),
    overrideReason: row.duplicate_override_reason,
  };
}

export async function listDistributionBeneficiaries(eventId) {
  const { data, error } = await supabase.from("distribution_claims").select(BENEFICIARY_SELECT).eq("event_id", eventId);
  if (error) throw error;
  return data.map(mapBeneficiary);
}

// Farmer Profile drawer: every (non-deleted) distribution this farmer was
// tagged in, newest first.
const FARMER_HISTORY_SELECT = `
  claim_id, quantity_received,
  commodities ( name, unit ),
  distribution_events ( event_id, event_date, program_name, status, is_deleted )
`;

export async function listFarmerDistributionHistory(farmerId) {
  const { data, error } = await supabase.from("distribution_claims").select(FARMER_HISTORY_SELECT).eq("farmer_id", farmerId);
  if (error) throw error;
  return data
    .filter((row) => row.distribution_events && !row.distribution_events.is_deleted)
    .map((row) => ({
      claimId: row.claim_id,
      eventId: row.distribution_events.event_id,
      date: row.distribution_events.event_date,
      program: row.distribution_events.program_name ?? "",
      status: dbStatusToLabel(row.distribution_events.status ?? "ongoing"),
      commodity: row.commodities?.name ?? "",
      unit: row.commodities?.unit ?? "kg",
      quantity: Number(row.quantity_received),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || String(b.eventId).localeCompare(String(a.eventId)));
}

// Distribution Report page 2+ (List of Beneficiaries): one row per tagged
// farmer per commodity, masterlist-style "Surname, First M." names sorted by
// surname. Deleted farmers are deliberately included, since this is a record
// of who received what.
const PRINT_BENEFICIARY_SELECT = `
  claim_id, farmer_id, quantity_received,
  farmers ( rsbsa_no, first_name, middle_name, surname, extension_name, sex ),
  commodities ( name, unit )
`;

function masterlistName(f) {
  if (!f) return "";
  const middle = f.middle_name ? ` ${f.middle_name.trim()[0]}.` : "";
  const ext = f.extension_name ? ` ${f.extension_name.trim()}` : "";
  return `${f.surname}, ${f.first_name}${middle}${ext}`;
}

export async function listPrintBeneficiaries(eventId) {
  const { data, error } = await supabase.from("distribution_claims").select(PRINT_BENEFICIARY_SELECT).eq("event_id", eventId);
  if (error) throw error;
  return data
    .map((row) => ({
      claimId: row.claim_id,
      farmerId: row.farmer_id,
      surname: row.farmers?.surname ?? "",
      firstName: row.farmers?.first_name ?? "",
      name: masterlistName(row.farmers),
      rsbsaNo: row.farmers?.rsbsa_no ?? "",
      sex: row.farmers?.sex === "male" ? "M" : row.farmers?.sex === "female" ? "F" : "",
      commodity: row.commodities?.name ?? "",
      unit: row.commodities?.unit ?? "kg",
      quantity: Number(row.quantity_received),
    }))
    .sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName) || a.commodity.localeCompare(b.commodity));
}

// ---------------------------------------------------------------------------
// Reports (Phase 4) — Beneficiary List / Distribution Summary / Attendance
// Sheet all read from actual tagged claims rather than the farmers table or
// the legacy headcount, so an untagged old distribution simply contributes
// no rows here (same "not tagged" gap shown on the Distributions page).
// ---------------------------------------------------------------------------
const BENEFICIARY_REPORT_SELECT = `
  claim_id, farmer_id, event_id, quantity_received,
  farmers ( rsbsa_no, first_name, surname, addresses ( barangay ) ),
  commodities ( name ),
  distribution_events ( event_id, event_date, program_name, status, completed_at, is_deleted )
`;

// Status, and so each farmer's acknowledgement (Completed = Acknowledged on
// completedAt), is one value per distribution, not the unused per-claim
// column — every row from the same distribution reports the same value.
function mapBeneficiaryReportRow(row) {
  const event = row.distribution_events;
  return {
    claimId: row.claim_id,
    farmerId: row.farmer_id,
    eventId: row.event_id,
    firstName: row.farmers?.first_name ?? "",
    lastName: row.farmers?.surname ?? "",
    rsbsaNo: row.farmers?.rsbsa_no ?? "",
    barangay: row.farmers?.addresses?.[0]?.barangay ?? "Langapud",
    commodity: row.commodities?.name ?? "",
    quantity: Number(row.quantity_received),
    eventDate: event?.event_date,
    program: event?.program_name,
    status: dbStatusToLabel(event?.status ?? "ongoing"),
    completedAt: event?.completed_at ?? null,
  };
}

export async function listBeneficiaryReport() {
  const { data, error } = await supabase.from("distribution_claims").select(BENEFICIARY_REPORT_SELECT);
  if (error) throw error;
  return data.filter((row) => row.distribution_events && !row.distribution_events.is_deleted).map(mapBeneficiaryReportRow);
}

// Same-commodity/program/year duplicate check — one call per tagged chip.
export async function checkDuplicateDistribution({ farmerId, commodityId, programName, year, excludeEventId }) {
  const { data, error } = await supabase.rpc("find_duplicate_distribution", {
    p_farmer_id: farmerId,
    p_commodity_id: commodityId,
    p_program_name: programName,
    p_year: year,
    p_exclude_event_id: excludeEventId ?? null,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { eventId: row.event_id, program: row.program_name, date: row.event_date, quantity: Number(row.quantity_received) };
}

// Atomic replace-and-insert via RPC (Phase 1) — nothing is half-saved if the
// event update and the beneficiary rows can't both go through.
export async function saveDistributionBeneficiaries(eventId, commodityId, beneficiaries) {
  const { error } = await supabase.rpc("save_distribution_beneficiaries", {
    p_event_id: eventId,
    p_commodity_id: commodityId,
    p_beneficiaries: beneficiaries.map((b) => ({
      farmer_id: b.farmerId,
      quantity_received: b.quantity,
      duplicate_override_reason: b.overrideReason || null,
    })),
  });
  if (error) throw error;
}

export async function markAllBeneficiariesReceived(eventId) {
  const { error } = await supabase.rpc("mark_all_beneficiaries_received", { p_event_id: eventId });
  if (error) throw error;
}

// taggedBeneficiaries: [{ farmerId, quantity, overrideReason }]
// — when non-empty, this is the source of truth for the item's total
// quantity and the old beneficiaries_count is set to match (kept in sync so
// anything still reading the legacy column isn't left stale).
export async function createDistribution({ program, venue, beneficiaries, commodityId, quantity, fundingSource, status, taggedBeneficiaries = [] }) {
  const effectiveCount = taggedBeneficiaries.length > 0 ? taggedBeneficiaries.length : Number(beneficiaries) || 0;
  const effectiveQuantity =
    taggedBeneficiaries.length > 0 ? taggedBeneficiaries.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0) : Number(quantity) || 0;

  const { data: event, error: eventErr } = await supabase
    .from("distribution_events")
    .insert({
      program_name: program,
      event_date: todayIso(),
      venue,
      funding_source: fundingSource || null,
      status: labelToDbStatus(status || "Ongoing"),
      beneficiaries_count: effectiveCount,
    })
    .select(
      "event_id, program_name, event_date, venue, barangay, funding_source, status, completed_at, remarks, beneficiaries_count",
    )
    .single();
  if (eventErr) throw eventErr;

  const { data: item, error: itemErr } = await supabase
    .from("distribution_event_items")
    .insert({ event_id: event.event_id, commodity_id: commodityId, quantity_allocated: effectiveQuantity })
    .select("event_item_id, commodity_id, quantity_allocated, commodities ( name, category, unit )")
    .single();
  if (itemErr) throw itemErr;

  if (taggedBeneficiaries.length > 0) {
    await saveDistributionBeneficiaries(event.event_id, commodityId, taggedBeneficiaries);
  }

  const summaries = await fetchSummaries([event.event_id]);
  return mapDistribution({ ...event, distribution_event_items: [item] }, summaries.get(event.event_id));
}

// Edits the event fields plus its first item's commodity/quantity (the
// same single-item shape createDistribution uses — this app has no
// stock/inventory tracking to reconcile, "Total Distributed" is always
// computed live from distribution_event_items, so overwriting the
// quantity here is all that's needed, no delta math). Distributions
// seeded with more than one item keep their other items untouched.
// RLS ("events: MAO writes" / "event_items: MAO writes") restricts both
// writes to mao_admin — FA President's call comes back empty. `status` is
// only passed when the admin changed it, so status_updated_by/at stay
// accurate.
export async function updateDistribution(eventId, { date, program, venue, barangay, fundingSource, beneficiaries, status, commodityId, quantity, itemId, taggedBeneficiaries = [] }) {
  const effectiveCount = taggedBeneficiaries.length > 0 ? taggedBeneficiaries.length : Number(beneficiaries) || 0;
  const effectiveQuantity =
    taggedBeneficiaries.length > 0 ? taggedBeneficiaries.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0) : Number(quantity) || 0;

  let statusFields = {};
  if (status) {
    const { data: auth } = await supabase.auth.getUser();
    statusFields = { status: labelToDbStatus(status), status_updated_by: auth?.user?.id ?? null, status_updated_at: new Date().toISOString() };
  }

  const { data: event, error: eventErr } = await supabase
    .from("distribution_events")
    .update({
      event_date: date,
      program_name: program,
      venue,
      barangay,
      funding_source: fundingSource || null,
      beneficiaries_count: effectiveCount,
      ...statusFields,
    })
    .eq("event_id", eventId)
    .select("event_id")
    .maybeSingle();
  if (eventErr) throw eventErr;
  if (!event) throw new Error("Couldn't update this distribution — refresh and try again.");

  if (itemId) {
    const { error: itemErr } = await supabase
      .from("distribution_event_items")
      .update({ commodity_id: commodityId, quantity_allocated: effectiveQuantity })
      .eq("event_item_id", itemId);
    if (itemErr) throw itemErr;
  } else {
    const { error: itemErr } = await supabase
      .from("distribution_event_items")
      .insert({ event_id: eventId, commodity_id: commodityId, quantity_allocated: effectiveQuantity });
    if (itemErr) throw itemErr;
  }

  if (taggedBeneficiaries.length > 0) {
    await saveDistributionBeneficiaries(eventId, commodityId, taggedBeneficiaries);
  }

  const { data, error } = await supabase.from("distribution_events").select(SELECT).eq("event_id", eventId).single();
  if (error) throw error;
  const summaries = await fetchSummaries([eventId]);
  return mapDistribution(data, summaries.get(eventId));
}

// RLS ("events: MAO writes") already restricts this to mao_admin — FA
// President rows never match, so .maybeSingle() coming back empty means
// either the row vanished or the caller isn't allowed to touch it.
export async function updateDistributionStatus(eventId, status) {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("distribution_events")
    .update({
      status: labelToDbStatus(status),
      status_updated_by: auth?.user?.id ?? null,
      status_updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't update this distribution's status — refresh and try again.");
  const summaries = await fetchSummaries([eventId]);
  return mapDistribution(data, summaries.get(eventId));
}

// Soft delete — sets is_deleted/deleted_at/deleted_by instead of removing
// the row, so distribution_event_items (and any claims against them) are
// preserved. RLS restricts this to mao_admin the same way it does status.
export async function deleteDistribution(eventId) {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("distribution_events")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: auth?.user?.id ?? null,
    })
    .eq("event_id", eventId)
    .select("event_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't delete this distribution — refresh and try again.");
  return eventId;
}

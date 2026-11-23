import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";
import { todayIso } from "../dates.js";
import { farmSummary } from "./farmers.js";

const SELECT = `
  event_id, program_name, event_date, venue, barangay, funding_source, status, completed_at, remarks, beneficiaries_count, allocation_kg,
  distribution_event_items ( event_item_id, commodity_id, quantity_allocated, commodities ( name, category, unit ) )
`;

const numberOrNull = (v) => (v === null || v === undefined ? null : Number(v));

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
    // Total allocation for the barangay (kg), when set.
    allocationKg: numberOrNull(row.allocation_kg),
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
  claim_id, farmer_id, commodity_id, quantity_received, duplicate_override_reason, farm_size_hectares, quantity_adjusted, adjustment_reason,
  rate_kg_per_ha,
  commodities ( unit ),
  farmers ( rsbsa_no, first_name, surname, status, deleted_at, seed_program_id, seed_program:commodities!seed_program_id ( name ), addresses ( barangay, street ),
    farm_parcels ( parcel_id, farm_size_hectares, crops ( crop_type ) ), profiles!profile_id ( avatar_url ) )
`;

// A deleted farmer's past distribution record is kept (never hidden here —
// see friendlyError.js's sibling rule in the Farmers page for the "hide
// deleted everywhere else" half of this), just flagged so the Distributions
// detail panel can show "(removed)" next to their name.
// farmSize is the size the quantity was computed from (kept on the claim);
// claims saved before that existed fall back to the farmer's current size.
function mapBeneficiary(row) {
  const address = row.farmers?.addresses?.[0];
  const current = farmSummary(row.farmers?.farm_parcels);
  return {
    claimId: row.claim_id,
    farmerId: row.farmer_id,
    commodityId: row.commodity_id,
    firstName: row.farmers?.first_name ?? "",
    lastName: row.farmers?.surname ?? "",
    rsbsaNo: row.farmers?.rsbsa_no ?? "",
    barangay: address?.barangay ?? "Langapud",
    sitioPurok: address?.street ?? "",
    cropType: current.cropType,
    farmSize: row.farm_size_hectares != null ? Number(row.farm_size_hectares) : current.farmSize,
    currentFarmSize: current.farmSize,
    status: dbStatusToLabel(row.farmers?.status ?? "active"),
    avatarUrl: row.farmers?.profiles?.avatar_url ?? null,
    farmerDeleted: !!row.farmers?.deleted_at,
    quantity: Number(row.quantity_received),
    unit: row.commodities?.unit ?? "kg",
    // The kg/ha rate this row was saved with (a later change to the
    // commodity's rate never alters it), and the farmer's Seed program.
    rate: numberOrNull(row.rate_kg_per_ha),
    seedProgramId: row.farmers?.seed_program_id ?? null,
    seedProgram: row.farmers?.seed_program?.name ?? "",
    adjusted: !!row.quantity_adjusted,
    adjustmentReason: row.adjustment_reason ?? "",
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
  claim_id, farmer_id, quantity_received, farm_size_hectares,
  farmers ( rsbsa_no, first_name, middle_name, surname, extension_name, sex, farm_parcels ( farm_size_hectares ) ),
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
      farmSize: row.farm_size_hectares != null ? Number(row.farm_size_hectares) : farmSummary(row.farmers?.farm_parcels).farmSize,
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
  claim_id, farmer_id, event_id, quantity_received, farm_size_hectares,
  farmers ( rsbsa_no, first_name, surname, addresses ( barangay ), farm_parcels ( farm_size_hectares ) ),
  commodities ( name, unit ),
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
    unit: row.commodities?.unit ?? "kg",
    farmSize: row.farm_size_hectares != null ? Number(row.farm_size_hectares) : farmSummary(row.farmers?.farm_parcels).farmSize,
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

// "Add all eligible farmers": Active farmers whose Seed program is this
// commodity (or, when nobody is enrolled in it, whose crop matches its
// category), each with their farm data and — when a program is given — the
// same-commodity/program/year distribution they already got.
// MAO Admin only (the database returns nothing to anyone else).
export async function listEligibleFarmers({ commodityId, programName, year, excludeEventId }) {
  const { data, error } = await supabase.rpc("distribution_eligible_farmers", {
    p_commodity_id: commodityId,
    p_program_name: programName || null,
    p_year: year,
    p_exclude_event_id: excludeEventId ?? null,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.farmer_id,
    rsbsaNo: r.rsbsa_no,
    firstName: r.first_name,
    lastName: r.surname,
    barangay: r.barangay ?? "Langapud",
    sitioPurok: r.sitio_purok ?? "",
    cropType: r.crop_type ?? "",
    farmSize: Number(r.farm_size_hectares) || 0,
    avatarUrl: r.avatar_url ?? null,
    seedProgramId: r.seed_program_id ?? null,
    status: "Active",
    duplicate: r.duplicate_program
      ? { program: r.duplicate_program, date: r.duplicate_date, quantity: Number(r.duplicate_quantity) }
      : null,
  }));
}

export async function markAllBeneficiariesReceived(eventId) {
  const { error } = await supabase.rpc("mark_all_beneficiaries_received", { p_event_id: eventId });
  if (error) throw error;
}

// Both saves go through save_distribution (database function): the event,
// its item and the full list of tagged farmers are written in one
// transaction, so nothing is half-saved if the connection drops.
// taggedBeneficiaries: [{ farmerId, quantity, overrideReason,
// adjustmentReason }] — when non-empty, its quantities are the item's total
// and beneficiaries_count follows the list; an empty list removes every
// tagged farmer. A quantity that differs from farm size × allocation per
// hectare needs its adjustmentReason (the database refuses it otherwise).
// recompute: the admin chose to use the commodity's current rate for a row
// saved with an older one (otherwise an unchanged row keeps its saved rate).
const toBeneficiaryPayload = (list) =>
  list.map((b) => ({
    farmer_id: b.farmerId,
    quantity_received: b.quantity,
    duplicate_override_reason: b.overrideReason || null,
    adjustment_reason: b.adjustmentReason || null,
    ...(b.recompute ? { recompute: true } : {}),
    // A rate for this distribution only (the commodity keeps its own).
    ...(b.rate != null ? { rate: b.rate } : {}),
  }));

// Ids from a <select> arrive as text; numeric ones are sent as numbers.
const idOf = (v) => (v === "" || v == null ? null : /^\d+$/.test(String(v)) ? Number(v) : v);

async function readDistribution(eventId) {
  const { data, error } = await supabase.from("distribution_events").select(SELECT).eq("event_id", eventId).single();
  if (error) throw error;
  const summaries = await fetchSummaries([eventId]);
  return mapDistribution(data, summaries.get(eventId));
}

export async function createDistribution({ program, venue, beneficiaries, commodityId, quantity, allocationKg = null, fundingSource, status, taggedBeneficiaries = [] }) {
  const { data: eventId, error } = await supabase.rpc("save_distribution", {
    p_event_id: null,
    p_event: {
      program_name: program,
      venue,
      funding_source: fundingSource || null,
      status: labelToDbStatus(status || "Ongoing"),
      event_date: todayIso(),
      beneficiaries_count: Number(beneficiaries) || 0,
      allocation_kg: allocationKg,
    },
    p_item_id: null,
    p_commodity_id: idOf(commodityId),
    p_quantity: Number(quantity) || 0,
    p_beneficiaries: toBeneficiaryPayload(taggedBeneficiaries),
  });
  if (error) throw error;
  return readDistribution(eventId);
}

// Edits the event fields plus its first item's commodity/quantity (the
// same single-item shape createDistribution uses — this app has no
// stock/inventory tracking to reconcile, "Total Distributed" is always
// computed live from distribution_event_items, so overwriting the
// quantity here is all that's needed, no delta math). Distributions
// seeded with more than one item keep their other items untouched.
// save_distribution only lets the MAO Admin do this. `status` is only
// passed when the admin changed it, so status_updated_by/at stay accurate.
// With no farmers tagged, the recorded beneficiary count is left as it was.
export async function updateDistribution(eventId, { date, program, venue, barangay, fundingSource, status, commodityId, quantity, allocationKg = null, itemId, taggedBeneficiaries = [] }) {
  const { error } = await supabase.rpc("save_distribution", {
    p_event_id: eventId,
    p_event: {
      program_name: program,
      venue,
      barangay,
      funding_source: fundingSource || null,
      event_date: date,
      allocation_kg: allocationKg,
      ...(status ? { status: labelToDbStatus(status) } : {}),
    },
    p_item_id: itemId ?? null,
    p_commodity_id: idOf(commodityId),
    p_quantity: Number(quantity) || 0,
    p_beneficiaries: toBeneficiaryPayload(taggedBeneficiaries),
  });
  if (error) throw error;
  return readDistribution(eventId);
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

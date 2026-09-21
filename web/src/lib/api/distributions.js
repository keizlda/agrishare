import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

const SELECT = `
  event_id, program_name, event_date, venue, barangay, funding_source, acknowledgement_status, status, remarks, beneficiaries_count,
  distribution_event_items ( quantity_allocated, commodities ( name, category, unit ) )
`;

function mapDistribution(row) {
  const items = (row.distribution_event_items ?? []).map((i) => ({
    name: i.commodities?.name ?? "",
    quantity: Number(i.quantity_allocated),
    unit: i.commodities?.unit ?? "kg",
  }));
  return {
    id: row.event_id,
    date: row.event_date,
    cropType: row.distribution_event_items?.[0]?.commodities?.category ?? "",
    barangay: row.barangay,
    beneficiaries: row.beneficiaries_count,
    status: dbStatusToLabel(row.status),
    venue: row.venue ?? "",
    program: row.program_name,
    fundingSource: row.funding_source ?? "",
    acknowledgementStatus: dbStatusToLabel(row.acknowledgement_status),
    remarks: row.remarks ?? "",
    items,
  };
}

export async function listDistributions() {
  const { data, error } = await supabase
    .from("distribution_events")
    .select(SELECT)
    .eq("is_deleted", false)
    .order("event_date", { ascending: false });
  if (error) throw error;
  return data.map(mapDistribution);
}

// Single-row fetch for the standalone print view, which loads in its own
// tab (no app state to reuse) and only needs the one distribution. Also
// excludes soft-deleted rows so a deleted distribution can't still be printed.
export async function getDistribution(eventId) {
  const { data, error } = await supabase.from("distribution_events").select(SELECT).eq("event_id", eventId).eq("is_deleted", false).single();
  if (error) throw error;
  return mapDistribution(data);
}

export async function createDistribution({ program, venue, beneficiaries, commodityId, quantity, fundingSource, acknowledgementStatus }) {
  const { data: event, error: eventErr } = await supabase
    .from("distribution_events")
    .insert({
      program_name: program,
      event_date: new Date().toISOString().slice(0, 10),
      venue,
      funding_source: fundingSource || null,
      acknowledgement_status: labelToDbStatus(acknowledgementStatus || "Pending"),
      status: "ongoing",
      beneficiaries_count: Number(beneficiaries) || 0,
    })
    .select(
      "event_id, program_name, event_date, venue, barangay, funding_source, acknowledgement_status, status, remarks, beneficiaries_count",
    )
    .single();
  if (eventErr) throw eventErr;

  const { data: item, error: itemErr } = await supabase
    .from("distribution_event_items")
    .insert({ event_id: event.event_id, commodity_id: commodityId, quantity_allocated: Number(quantity) || 0 })
    .select("quantity_allocated, commodities ( name, category, unit )")
    .single();
  if (itemErr) throw itemErr;

  return mapDistribution({ ...event, distribution_event_items: [item] });
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
  return mapDistribution(data);
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

import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

const SELECT = `
  event_id, program_name, event_date, venue, status, beneficiaries_count,
  distribution_event_items ( quantity_allocated, commodities ( name, unit ) )
`;

// Farmers see the barangay-wide activity feed (all events), not just their
// own claims — mirrors the original mock's behavior. `item`/`quantity`
// collapse a possibly-multi-commodity event into one headline figure: the
// first item's name and the summed quantity across all items in the event.
function mapDistribution(row) {
  const items = row.distribution_event_items ?? [];
  const totalQty = items.reduce((sum, i) => sum + Number(i.quantity_allocated), 0);
  return {
    id: row.event_id,
    program: row.program_name,
    date: row.event_date,
    venue: row.venue ?? "",
    item: items[0]?.commodities?.name ?? "",
    quantity: totalQty,
    unit: items[0]?.commodities?.unit ?? "kg",
    farmersReceived: row.beneficiaries_count,
    status: dbStatusToLabel(row.status),
  };
}

export async function listDistributions() {
  const { data, error } = await supabase.from("distribution_events").select(SELECT).order("event_date", { ascending: false });
  if (error) throw error;
  return data.map(mapDistribution);
}

// ---------------------------------------------------------------------------
// Phase 5: farmer-scoped feed — only distributions this farmer was actually
// tagged in (via distribution_claims, RLS-scoped to their own rows), each
// with their own quantity and acknowledgement, never another farmer's data.
// ---------------------------------------------------------------------------
const MY_CLAIM_SELECT = `
  claim_id, quantity_received, acknowledgement_status,
  commodities ( name, unit ),
  distribution_events ( event_id, program_name, event_date, venue, status, funding_source, is_deleted )
`;

function mapMyDistribution(row) {
  const event = row.distribution_events ?? {};
  return {
    claimId: row.claim_id,
    id: event.event_id,
    program: event.program_name,
    date: event.event_date,
    venue: event.venue ?? "",
    status: dbStatusToLabel(event.status),
    fundingSource: event.funding_source ?? "",
    item: row.commodities?.name ?? "",
    quantity: Number(row.quantity_received),
    unit: row.commodities?.unit ?? "kg",
    acknowledgementStatus: row.acknowledgement_status === "received" ? "Received" : "Pending",
  };
}

// Newest first, grouping by year is left to the screen (a display concern).
export async function listMyDistributions() {
  const { data, error } = await supabase.from("distribution_claims").select(MY_CLAIM_SELECT);
  if (error) throw error;
  return data
    .filter((row) => row.distribution_events && !row.distribution_events.is_deleted)
    .map(mapMyDistribution)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

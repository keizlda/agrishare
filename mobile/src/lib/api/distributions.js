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

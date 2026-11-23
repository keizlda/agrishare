import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

// One rate per commodity (Nov 23, 2026): commodities.allocation_per_hectare,
// in kg per hectare, optional. Varieties are separate commodities, e.g.
// "Rice Seeds – Inbred (RCEF)" 40 and "Rice Seeds – Hybrid" 15. The database
// checks the rate, stamps who changed it and logs the change; only the MAO
// Admin can write (RLS "commodities: MAO writes").
const SELECT = `
  commodity_id, name, category, unit, status, created_at, deleted_at,
  allocation_per_hectare, rate_updated_at, rate_updater:profiles!rate_updated_by ( full_name )
`;

// Category choices (older free-text values still show and are kept).
export const COMMODITY_CATEGORIES = ["Rice", "Corn", "Vegetables", "Fertilizer", "Farm Tools", "Livestock", "Other"];

// The listed category matching a stored one ("rice" → "Rice"), or the
// stored text when it isn't one of them.
export function categoryOption(category) {
  const c = (category ?? "").trim();
  return COMMODITY_CATEGORIES.find((x) => x.toLowerCase() === c.toLowerCase()) ?? c;
}

function mapCommodity(row) {
  return {
    id: row.commodity_id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    status: dbStatusToLabel(row.status),
    dateAdded: row.created_at,
    deletedAt: row.deleted_at,
    rate: row.allocation_per_hectare != null ? Number(row.allocation_per_hectare) : null,
    rateUpdatedAt: row.rate_updated_at ?? null,
    rateUpdatedBy: row.rate_updater?.full_name ?? null,
  };
}

// Every picker/listing (this page, dropdowns, the New Distribution item
// picker, dashboard widgets) goes through this one function, so filtering
// deleted_at here is what "hidden everywhere" actually means — soft-deleted
// rows stay fully readable (RLS is unchanged) so joins from old distribution
// items/claims/requests can still resolve a deleted commodity's name.
// includeDeleted is for the one place that needs the opposite: a printed
// report totaling historical distributions per commodity, which must keep
// showing a since-deleted commodity's row.
export async function listCommodities({ includeDeleted = false } = {}) {
  let query = supabase.from("commodities").select(SELECT);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapCommodity);
}

const rateValue = (rate) => (rate === "" || rate == null ? null : Number(rate));

// Adds a commodity (always measured in kg) or edits one. `rate` is kg per
// hectare, or "" / null for "not given by hectare".
export async function saveCommodity(commodityId, { name, category, rate, status }) {
  const row = { name: name.trim(), category, allocation_per_hectare: rateValue(rate) };
  if (status) row.status = labelToDbStatus(status);
  const query = commodityId
    ? supabase.from("commodities").update(row).eq("commodity_id", commodityId)
    : supabase.from("commodities").insert({ ...row, unit: "kg", status: row.status ?? "active" });
  const { data, error } = await query.select(SELECT).maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error("A commodity with this name already exists.");
    throw error;
  }
  if (!data) throw new Error("Only the MAO Admin can add or edit commodities.");
  return mapCommodity(data);
}

export async function setCommodityStatus(commodityId, statusLabel) {
  const { error } = await supabase.from("commodities").update({ status: labelToDbStatus(statusLabel) }).eq("commodity_id", commodityId);
  if (error) throw error;
}

// Soft delete: sets deleted_at instead of removing the row, so distribution
// items/claims/requests that reference this commodity keep a real row to
// join against — old records and printed reports keep showing its name.
// RLS ("commodities: MAO writes", for all -> mao_admin) already restricts
// this UPDATE to admins; a blocked write (FA President) comes back empty.
export async function deleteCommodity(commodityId) {
  const { data, error } = await supabase
    .from("commodities")
    .update({ deleted_at: new Date().toISOString() })
    .eq("commodity_id", commodityId)
    .select("commodity_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't delete this commodity — refresh and try again.");
}

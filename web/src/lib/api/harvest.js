import { supabase } from "../supabaseClient.js";

// Harvest reports (MAO presentation, Nov 2026), in kilograms. The database
// decides who may do what (harvest_reports RLS + its guard trigger):
//   Farmer (mobile): adds their own; corrects/resubmits while Pending or
//     Rejected.
//   Farmers' Association President: reads all; corrects the ones they filed
//     earlier, before verification (only farmers add reports, from the
//     mobile app).
//   MAO Admin: reads all; Approve / Reject (remarks required to reject).

// A harvest is identified by its harvest date (no Wet/Dry season since Nov
// 24, 2026): summaries show the month and year, e.g. "8,400 kg · Nov 2026".
export const HARVEST_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const STATUS_LABEL = Object.fromEntries(HARVEST_STATUSES.map((s) => [s.value, s.label]));

export const HARVEST_LIMITS = { remarks: 500, maxKg: 10000000 };

const BUCKET = "harvest-photos";

const SELECT = `
  harvest_report_id, farmer_id, commodity_id, area_harvested_ha, yield_kg, yield_per_ha,
  harvest_date, photo_path, latitude, longitude, gps_accuracy_meters, photo_captured_at, distribution_claim_id, request_id,
  remarks, status, review_remarks, reviewed_at, submitted_by, resubmitted_at, created_at, updated_at,
  commodities ( name ),
  farmers ( farmer_id, rsbsa_no, first_name, surname, profile_id, addresses ( barangay, barangay_id, street ), farm_parcels ( farm_size_hectares ), profiles!profile_id ( avatar_url ) ),
  reviewer:profiles!reviewed_by ( full_name ),
  submitter:profiles!submitted_by ( full_name, role )
`;

const num = (v) => (v == null ? null : Number(v));

// "Nov 2026" for a harvest date ("2026-11-08").
export function harvestMonth(iso) {
  if (!iso) return "";
  const [y, m] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function mapHarvest(row) {
  const f = row.farmers;
  const farmSize = Math.round((f?.farm_parcels ?? []).reduce((s, p) => s + (Number(p.farm_size_hectares) || 0), 0) * 100) / 100;
  const filedByStaff = row.submitter?.role === "fa_president" || row.submitter?.role === "mao_admin";
  return {
    id: row.harvest_report_id,
    farmerId: row.farmer_id,
    farmerName: f ? `${f.first_name} ${f.surname}` : "Farmer",
    firstName: f?.first_name ?? "",
    lastName: f?.surname ?? "",
    avatarUrl: f?.profiles?.avatar_url ?? null,
    rsbsaNo: f?.rsbsa_no ?? "",
    barangay: f?.addresses?.[0]?.barangay ?? "",
    barangayId: f?.addresses?.[0]?.barangay_id ?? null,
    sitioPurok: f?.addresses?.[0]?.street ?? "",
    farmSize,
    harvestMonth: harvestMonth(row.harvest_date),
    commodityId: row.commodity_id,
    commodityName: row.commodities?.name ?? "",
    crop: row.commodities?.name ?? "",
    areaHa: num(row.area_harvested_ha),
    yieldKg: num(row.yield_kg),
    yieldPerHa: num(row.yield_per_ha),
    harvestDate: row.harvest_date,
    photoPath: row.photo_path,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    gpsAccuracy: num(row.gps_accuracy_meters),
    photoCapturedAt: row.photo_captured_at,
    claimId: row.distribution_claim_id,
    requestId: row.request_id,
    remarks: row.remarks ?? "",
    statusKey: row.status,
    status: STATUS_LABEL[row.status] ?? row.status,
    reviewRemarks: row.review_remarks ?? "",
    reviewerName: row.reviewer?.full_name ?? "MAO Admin",
    reviewedAt: row.reviewed_at,
    submittedBy: row.submitted_by,
    submitterName: row.submitter?.full_name ?? "",
    filedByStaff,
    filedByFa: row.submitter?.role === "fa_president",
    resubmittedAt: row.resubmitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Not removed, newest harvest first. RLS returns all (staff) or own (farmer).
export async function listHarvestReports({ farmerId } = {}) {
  let query = supabase.from("harvest_reports").select(SELECT).is("deleted_at", null);
  if (farmerId != null) query = query.eq("farmer_id", farmerId);
  const { data, error } = await query.order("harvest_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapHarvest);
}

// The report's photo (taken by the farmer in the mobile app), from the
// private harvest-photos bucket.
export async function getHarvestPhotoUrl(path, expiresInSeconds = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Ids from a <select> arrive as text; numeric ones are sent as numbers.
const idOf = (v) => (v === "" || v == null ? null : /^\d+$/.test(String(v)) ? Number(v) : v);

const toRow = (form) => ({
  commodity_id: idOf(form.commodityId),
  area_harvested_ha: Number(form.areaHa),
  yield_kg: Number(form.yieldKg),
  harvest_date: form.harvestDate,
  remarks: form.remarks.trim() || null,
});

// Correct a report (before approval); a Rejected one goes back to
// Pending.
export async function updateHarvestReport(report, form) {
  const { data, error } = await supabase.from("harvest_reports").update(toRow(form)).eq("harvest_report_id", report.id).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This harvest report can't be changed any more. Refresh to see its current status.");
  return mapHarvest(data);
}

// MAO Admin: "approved" or "rejected" (remarks required to reject).
export async function reviewHarvestReport(id, status, remarks) {
  const patch = { status, review_remarks: remarks?.trim() || null };
  const { data, error } = await supabase.from("harvest_reports").update(patch).eq("harvest_report_id", id).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This harvest report was removed or changed by someone else. Refresh and try again.");
  return mapHarvest(data);
}

export async function removeHarvestReport(id) {
  const { data, error } = await supabase.from("harvest_reports").update({ deleted_at: new Date().toISOString() }).eq("harvest_report_id", id).select("harvest_report_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This harvest report can't be removed. Refresh to see its current status.");
}

// The crops a harvest can be reported for: active commodities measured in kg
// that have a kg-per-hectare allocation (the seed programs, e.g. "Rice
// Seeds – Inbred (RCEF)"), managed in the distribution form. If none has a
// rate yet, every active kg commodity.
export function harvestCrops(commodities) {
  const active = commodities.filter((c) => c.status === "Active" && c.unit === "kg");
  const withRate = active.filter((c) => c.rate > 0);
  return withRate.length ? withRate : active;
}

// The "already reported" warning: another report by this farmer for the same
// crop with a harvest date within 60 days of this one (a warning only — two
// harvests can be that close). Null when there's none or it can't be checked.
export const DUPLICATE_WINDOW_DAYS = 60;
export async function findRecentHarvest({ farmerId, commodityId, harvestDate, excludeId = null }) {
  if (!farmerId || !commodityId || !/^\d{4}-\d{2}-\d{2}$/.test(harvestDate ?? "")) return null;
  const shift = (days) => new Date(new Date(`${harvestDate}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  let query = supabase
    .from("harvest_reports")
    .select("harvest_report_id, harvest_date, yield_kg, status")
    .eq("farmer_id", farmerId)
    .eq("commodity_id", idOf(commodityId))
    .gte("harvest_date", shift(-DUPLICATE_WINDOW_DAYS))
    .lte("harvest_date", shift(DUPLICATE_WINDOW_DAYS))
    .is("deleted_at", null)
    .order("harvest_date", { ascending: false })
    .limit(2);
  if (excludeId != null) query = query.neq("harvest_report_id", excludeId);
  const { data, error } = await query;
  if (error || !data?.length) return null;
  const r = data[0];
  return { id: r.harvest_report_id, harvestDate: r.harvest_date, yieldKg: num(r.yield_kg), status: STATUS_LABEL[r.status] ?? r.status };
}

// Harvests whose harvest date falls in a year ("this year" on the
// dashboard), by the Philippine calendar.
export const inYear = (list, year) => list.filter((h) => String(h.harvestDate ?? "").startsWith(String(year)));

// "3,200 kg/ha" style rounding helpers shared by the page and reports.
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export function totals(reports) {
  const kg = round2(reports.reduce((s, r) => s + (r.yieldKg ?? 0), 0));
  const ha = round2(reports.reduce((s, r) => s + (r.areaHa ?? 0), 0));
  return { count: reports.length, kg, ha, perHa: ha > 0 ? round2(kg / ha) : null };
}

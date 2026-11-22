import { supabase } from "../supabaseClient.js";
import { isNetworkError } from "../friendlyError.js";
import { activeTypes } from "../allocation.js";

// Harvest reports (MAO presentation, Nov 2026), in kilograms. The database
// decides who may do what (harvest_reports RLS + its guard trigger):
//   Farmer (mobile): adds their own; corrects/resubmits while Submitted or
//     Returned.
//   Farmers' Association President: reads all; adds for a farmer; corrects
//     the ones they filed before verification.
//   MAO Admin: reads all; adds for a farmer; Verify / Return (remarks
//     required to return).

export const SEASONS = [
  { value: "wet", label: "Wet" },
  { value: "dry", label: "Dry" },
];
const SEASON_LABEL = Object.fromEntries(SEASONS.map((s) => [s.value, s.label]));

export const HARVEST_STATUSES = [
  { value: "submitted", label: "Submitted" },
  { value: "verified", label: "Verified" },
  { value: "returned", label: "Returned" },
];
const STATUS_LABEL = Object.fromEntries(HARVEST_STATUSES.map((s) => [s.value, s.label]));

export const HARVEST_LIMITS = { remarks: 500, maxKg: 10000000 };

const BUCKET = "harvest-photos";
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const SELECT = `
  harvest_report_id, farmer_id, season, season_year, commodity_id, commodity_type_id, area_harvested_ha, yield_kg, yield_per_ha,
  harvest_date, photo_path, latitude, longitude, gps_accuracy_meters, photo_captured_at, distribution_claim_id, request_id,
  remarks, status, review_remarks, reviewed_at, submitted_by, resubmitted_at, created_at, updated_at,
  commodities ( name ),
  commodity_types ( name ),
  farmers ( farmer_id, rsbsa_no, first_name, surname, profile_id, addresses ( barangay, street ), farm_parcels ( farm_size_hectares ), profiles!profile_id ( avatar_url ) ),
  reviewer:profiles!reviewed_by ( full_name ),
  submitter:profiles!submitted_by ( full_name, role )
`;

const num = (v) => (v == null ? null : Number(v));

export function seasonLabel(season, year) {
  return `${SEASON_LABEL[season] ?? season} ${year}`;
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
    barangay: f?.addresses?.[0]?.barangay ?? "Langapud",
    sitioPurok: f?.addresses?.[0]?.street ?? "",
    farmSize,
    season: row.season,
    seasonYear: row.season_year,
    seasonLabel: seasonLabel(row.season, row.season_year),
    commodityId: row.commodity_id,
    commodityName: row.commodities?.name ?? "",
    typeId: row.commodity_type_id,
    typeName: row.commodity_types?.name ?? "",
    crop: [row.commodities?.name, row.commodity_types?.name].filter(Boolean).join(" · "),
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

// ---------------------------------------------------------------------------
// Photo (optional on web): JPG, PNG or WebP up to 10 MB, in the farmer's
// folder of the private harvest-photos bucket.
// ---------------------------------------------------------------------------
async function looksLike(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...head.slice(from, to));
  if (file.type === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (file.type === "image/png") return [0x89, 0x50, 0x4e, 0x47].every((b, i) => head[i] === b);
  return [0xff, 0xd8, 0xff].every((b, i) => head[i] === b);
}

export async function validatePhoto(file) {
  if (!PHOTO_TYPES.includes(file.type)) return "Attach a JPG, PNG or WebP photo.";
  if (file.size > MAX_PHOTO_BYTES) return "The photo must be 10 MB or smaller.";
  if (!(await looksLike(file))) return "That file doesn't look like the photo its name says. Choose another file.";
  return null;
}

async function uploadPhoto(farmerId, file) {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${farmerId}/${random}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) {
    if (isNetworkError(error)) throw error;
    if (String(error.statusCode ?? error.status) === "413" || /maximum allowed size|too large/i.test(error.message ?? "")) throw new Error("The photo must be 10 MB or smaller.");
    if (/mime type|not supported|invalid file type/i.test(error.message ?? "")) throw new Error("Attach a JPG, PNG or WebP photo.");
    throw error;
  }
  return path;
}

export async function getHarvestPhotoUrl(path, expiresInSeconds = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Ids from a <select> arrive as text; numeric ones are sent as numbers.
const idOf = (v) => (v === "" || v == null ? null : /^\d+$/.test(String(v)) ? Number(v) : v);

const toRow = (form) => ({
  season: form.season,
  season_year: Number(form.seasonYear),
  commodity_id: idOf(form.commodityId),
  commodity_type_id: idOf(form.typeId),
  area_harvested_ha: Number(form.areaHa),
  yield_kg: Number(form.yieldKg),
  harvest_date: form.harvestDate,
  remarks: form.remarks.trim() || null,
});

// Staff add a report for a farmer (the photo, if any, is uploaded first).
export async function createHarvestReport(farmerId, form, photo) {
  const photoPath = photo ? await uploadPhoto(farmerId, photo) : null;
  const row = { ...toRow(form), farmer_id: farmerId, photo_path: photoPath, photo_captured_at: photo ? new Date().toISOString() : null };
  const { data, error } = await supabase.from("harvest_reports").insert(row).select(SELECT).single();
  if (error) {
    if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]).catch(() => {});
    throw error;
  }
  return mapHarvest(data);
}

// Correct a report (before verification); a Returned one goes back to
// Submitted.
export async function updateHarvestReport(report, form) {
  const { data, error } = await supabase.from("harvest_reports").update(toRow(form)).eq("harvest_report_id", report.id).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This harvest report can't be changed any more. Refresh to see its current status.");
  return mapHarvest(data);
}

// MAO Admin: "verified" or "returned" (remarks required to return).
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
// that have programs / types (seeds), managed on the Commodities page. If
// none has types yet, every active kg commodity.
export function harvestCrops(commodities) {
  const active = commodities.filter((c) => c.status === "Active" && c.unit === "kg");
  const withTypes = active.filter((c) => activeTypes(c).length > 0);
  return withTypes.length ? withTypes : active;
}

// The season a harvest on this date most likely belongs to: wet-season
// crops are harvested from about August to January, dry-season crops from
// about February to July. Only a starting value; the user can change it.
export function guessSeason(iso) {
  const [y, m] = (iso || new Date().toISOString().slice(0, 10)).split("-").map(Number);
  if (m >= 8) return { season: "wet", seasonYear: y };
  if (m === 1) return { season: "wet", seasonYear: y - 1 };
  return { season: "dry", seasonYear: y };
}

// "3,200 kg/ha" style rounding helpers shared by the page and reports.
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export function totals(reports) {
  const kg = round2(reports.reduce((s, r) => s + (r.yieldKg ?? 0), 0));
  const ha = round2(reports.reduce((s, r) => s + (r.areaHa ?? 0), 0));
  return { count: reports.length, kg, ha, perHa: ha > 0 ? round2(kg / ha) : null };
}

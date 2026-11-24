import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "../supabaseClient";

// The farmer's own harvest reports, in kilograms (RLS returns only theirs).
// The MAO verifies a report or rejects it with remarks; a rejected report
// can be corrected and resubmitted.

const BUCKET = "harvest-photos";

// A harvest is identified by its harvest date (no Wet/Dry season): summaries
// show the month and year, e.g. "8,400 kg · Nov 2026".
const STATUS_LABEL = { submitted: "Submitted", verified: "Verified", rejected: "Rejected" };

const SELECT = `
  harvest_report_id, commodity_id, area_harvested_ha, yield_kg, yield_per_ha,
  harvest_date, photo_path, latitude, longitude, distribution_claim_id, remarks, status, review_remarks, reviewed_at,
  submitted_by, resubmitted_at, created_at,
  commodities ( name )
`;

const num = (v) => (v == null ? null : Number(v));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Nov 2026" for a harvest date ("2026-11-08").
export function harvestMonth(iso) {
  if (!iso) return "";
  const [y, m] = String(iso).slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1] ?? ""} ${y}`;
}

function mapHarvest(row) {
  return {
    id: row.harvest_report_id,
    harvestMonth: harvestMonth(row.harvest_date),
    commodityId: row.commodity_id,
    crop: row.commodities?.name ?? "",
    areaHa: num(row.area_harvested_ha),
    yieldKg: num(row.yield_kg),
    yieldPerHa: num(row.yield_per_ha),
    harvestDate: row.harvest_date,
    photoPath: row.photo_path,
    hasGps: row.latitude != null,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    claimId: row.distribution_claim_id,
    remarks: row.remarks ?? "",
    statusKey: row.status,
    status: STATUS_LABEL[row.status] ?? row.status,
    reviewRemarks: row.review_remarks ?? "",
    reviewedAt: row.reviewed_at,
    submittedBy: row.submitted_by,
    resubmittedAt: row.resubmitted_at,
    createdAt: row.created_at,
  };
}

export async function listMyHarvestReports() {
  const { data, error } = await supabase
    .from("harvest_reports")
    .select(SELECT)
    .is("deleted_at", null)
    .order("harvest_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapHarvest);
}

// A short-lived link to a report's photo (the farmer can read their own).
export async function getHarvestPhotoUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// The geotagged photo (already stamped by the capture screen), in the
// farmer's own folder. Same native/web upload split as proof of planting.
export async function uploadHarvestPhoto(farmerId, uri) {
  const path = `${farmerId}/harvest-${Date.now()}.jpg`;
  if (Platform.OS === "web") {
    const blob = await fetch(uri).then((res) => res.blob());
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

const toRow = (form) => ({
  commodity_id: form.commodityId,
  area_harvested_ha: Number(form.areaHa),
  yield_kg: Number(form.yieldKg),
  harvest_date: form.harvestDate,
  distribution_claim_id: form.claimId ?? null,
  remarks: form.remarks.trim() || null,
  // The photo carries its own location; a location captured without a
  // photo is saved too.
  ...(form.photo ? { photo_path: form.photo.path, photo_captured_at: new Date().toISOString() } : {}),
  ...(form.gps
    ? {
        latitude: Math.round(form.gps.latitude * 1e6) / 1e6,
        longitude: Math.round(form.gps.longitude * 1e6) / 1e6,
        gps_accuracy_meters: form.gps.accuracy != null ? Math.round(form.gps.accuracy * 10) / 10 : null,
      }
    : {}),
});

export async function submitHarvestReport(farmerId, form) {
  const { data, error } = await supabase
    .from("harvest_reports")
    .insert({ ...toRow(form), farmer_id: farmerId })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapHarvest(data);
}

// Correct a Submitted or Rejected report; a Rejected one goes back to
// Submitted for the MAO.
export async function updateHarvestReport(id, form) {
  const { data, error } = await supabase.from("harvest_reports").update(toRow(form)).eq("harvest_report_id", id).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This harvest report was already verified and can't be changed. Pull down to refresh.");
  return mapHarvest(data);
}

// The "already reported" warning: another of the farmer's reports for the
// same crop with a harvest date within 60 days of this one (a warning only).
export const DUPLICATE_WINDOW_DAYS = 60;
export async function findRecentHarvest({ commodityId, harvestDate, excludeId = null }) {
  if (!commodityId || !/^\d{4}-\d{2}-\d{2}$/.test(harvestDate ?? "")) return null;
  const shift = (days) => new Date(new Date(`${harvestDate}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  let query = supabase
    .from("harvest_reports")
    .select("harvest_report_id, harvest_date, yield_kg, status")
    .eq("commodity_id", commodityId)
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

// Crops a harvest can be reported for: active kg commodities with a
// kg-per-hectare allocation (the seed programs, managed by the MAO on the
// web); if none has a rate, every active kg commodity.
export function harvestCrops(commodities) {
  const active = commodities.filter((c) => c.status === "Active" && c.unit === "kg");
  const withRate = active.filter((c) => c.rate > 0);
  return withRate.length ? withRate : active;
}

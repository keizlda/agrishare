import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "../supabaseClient";

// The farmer's own harvest reports, in kilograms (RLS returns only theirs).
// The MAO verifies a report or returns it with remarks; a returned report
// can be corrected and resubmitted.

const BUCKET = "harvest-photos";

export const SEASONS = [
  { value: "wet", label: "Wet" },
  { value: "dry", label: "Dry" },
];
const SEASON_LABEL = { wet: "Wet", dry: "Dry" };
const STATUS_LABEL = { submitted: "Submitted", verified: "Verified", returned: "Returned" };

const SELECT = `
  harvest_report_id, season, season_year, commodity_id, commodity_type_id, area_harvested_ha, yield_kg, yield_per_ha,
  harvest_date, photo_path, latitude, longitude, distribution_claim_id, remarks, status, review_remarks, reviewed_at,
  submitted_by, resubmitted_at, created_at,
  commodities ( name ),
  commodity_types ( name )
`;

const num = (v) => (v == null ? null : Number(v));

function mapHarvest(row) {
  return {
    id: row.harvest_report_id,
    season: row.season,
    seasonYear: row.season_year,
    seasonLabel: `${SEASON_LABEL[row.season] ?? row.season} ${row.season_year}`,
    commodityId: row.commodity_id,
    typeId: row.commodity_type_id,
    crop: [row.commodities?.name, row.commodity_types?.name].filter(Boolean).join(" · "),
    areaHa: num(row.area_harvested_ha),
    yieldKg: num(row.yield_kg),
    yieldPerHa: num(row.yield_per_ha),
    harvestDate: row.harvest_date,
    photoPath: row.photo_path,
    hasGps: row.latitude != null,
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
  season: form.season,
  season_year: Number(form.seasonYear),
  commodity_id: form.commodityId,
  commodity_type_id: form.typeId ?? null,
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

// Correct a Submitted or Returned report; a Returned one goes back to
// Submitted for the MAO.
export async function updateHarvestReport(id, form) {
  const { data, error } = await supabase.from("harvest_reports").update(toRow(form)).eq("harvest_report_id", id).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This harvest report was already verified and can't be changed. Pull down to refresh.");
  return mapHarvest(data);
}

// The season a harvest on this date most likely belongs to: wet-season
// crops are harvested from about August to January, dry-season crops from
// about February to July. Only a starting value.
export function guessSeason(iso) {
  const [y, m] = iso.split("-").map(Number);
  if (m >= 8) return { season: "wet", seasonYear: y };
  if (m === 1) return { season: "wet", seasonYear: y - 1 };
  return { season: "dry", seasonYear: y };
}

// Crops a harvest can be reported for: active kg commodities with programs /
// types (managed by the MAO on the web); if none has types, every active kg
// commodity.
export function harvestCrops(commodities) {
  const active = commodities.filter((c) => c.status === "Active" && c.unit === "kg");
  const withTypes = active.filter((c) => c.types.length > 0);
  return withTypes.length ? withTypes : active;
}

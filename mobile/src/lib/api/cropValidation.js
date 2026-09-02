import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

const LIST_SELECT = "validation_id, photo_url, latitude, longitude, captured_at, status, remarks, reviewed_at, created_at";

function mapValidation(row) {
  return {
    id: row.validation_id,
    photoPath: row.photo_url,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    capturedAt: row.captured_at,
    submittedAt: row.created_at,
    status: dbStatusToLabel(row.status),
    // Shared column on both clients: it's the farmer's own note while
    // pending, then gets overwritten with the reviewer's remark once
    // reviewed (web/src/lib/api/cropValidation.js's reviewSubmission) — so
    // once status is Rejected, this IS the reviewer's reason.
    remarks: row.remarks ?? "",
    reviewedAt: row.reviewed_at,
  };
}

// RLS scopes crop_validations to the requesting farmer's own rows (same
// pattern as listMyRequests) — no explicit farmer_id filter needed.
export async function listMyCropValidations() {
  const { data, error } = await supabase.from("crop_validations").select(LIST_SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapValidation);
}

// photo_url is a private Storage object path, not a public URL — mirrors
// web's getSignedPhotoUrl exactly.
export async function getSignedPhotoUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("crop-validation-photos").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Uploads a photo captured via expo-image-picker (see CropValidationScreen)
// to the real crop-validation-photos Storage bucket, under this farmer's own
// folder, so MAO/FA review queues see the actual proof-of-planting photo.
//
// The upload path is native/web split: on native, RN's fetch-to-blob on a
// local file:// URI is unreliable, so Expo's Storage guide reads the file as
// base64 and decodes it to an ArrayBuffer instead. On web, ImagePicker
// returns a blob/data URL that a plain fetch().blob() handles directly.
export async function uploadCropPhoto(farmerId, uri) {
  const path = `${farmerId}/${Date.now()}.jpg`;

  if (Platform.OS === "web") {
    const blob = await fetch(uri).then((res) => res.blob());
    const { error } = await supabase.storage.from("crop-validation-photos").upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  }

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const { error } = await supabase.storage.from("crop-validation-photos").upload(path, decode(base64), {
    contentType: "image/jpeg",
  });
  if (error) throw error;
  return path;
}

export async function submitCropValidation({ farmerId, photoPath, latitude, longitude, gpsAccuracyMeters, remarks }) {
  const { data, error } = await supabase
    .from("crop_validations")
    .insert({
      farmer_id: farmerId,
      photo_url: photoPath,
      latitude,
      longitude,
      gps_accuracy_meters: gpsAccuracyMeters,
      captured_at: new Date().toISOString(),
      remarks: remarks || null,
      status: "pending",
    })
    .select("validation_id")
    .single();
  if (error) throw error;
  return data;
}

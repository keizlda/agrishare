import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "../supabaseClient";

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

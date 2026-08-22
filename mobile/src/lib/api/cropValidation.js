import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import { decode } from "base64-arraybuffer";
import { supabase } from "../supabaseClient";

// Camera capture is mocked (see CropValidationScreen) — real camera/GPS
// wiring needs expo-image-picker + expo-location native permission flows,
// out of scope for "wire the backend". What IS real: the bundled placeholder
// photo gets uploaded to the actual crop-validation-photos Storage bucket
// under this farmer's own folder, and a real crop_validations row is created
// so MAO/FA review queues see genuine data, not a stub.
//
// The upload path is native/web split: on native, RN's fetch-to-blob on a
// local file:// URI is unreliable, so Expo's Storage guide reads the file as
// base64 and decodes it to an ArrayBuffer instead. On web the asset is
// already an http(s) URL, so a plain fetch().blob() is simpler and works
// where the native-oriented expo-asset/expo-file-system APIs don't.
export async function uploadPlaceholderCropPhoto(farmerId) {
  const path = `${farmerId}/${Date.now()}.jpg`;
  const asset = Asset.fromModule(require("../../assets/login-bg.jpg"));
  await asset.downloadAsync();

  if (Platform.OS === "web") {
    const blob = await fetch(asset.localUri ?? asset.uri).then((res) => res.blob());
    const { error } = await supabase.storage.from("crop-validation-photos").upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  }

  const base64 = await FileSystem.readAsStringAsync(asset.localUri ?? asset.uri, { encoding: "base64" });
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

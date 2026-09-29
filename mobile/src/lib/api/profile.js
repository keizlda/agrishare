import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "../supabaseClient";

// avatars is a private bucket (see 20260929160000_profile_avatar.sql), so a
// signed URL is required to read a file back. A very long expiry lets
// avatar_url store one stable link instead of re-signing on every render —
// mirrors the read pattern in api/cropValidation.js, just with a much longer
// TTL since crop photos are shown on-demand and avatars are shown constantly.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // 5 years

function avatarPath(userId) {
  return `${userId}/avatar.jpg`;
}

// Same native/web split as uploadCropPhoto (api/cropValidation.js) — RN's
// fetch-to-blob on a local file:// URI isn't reliable, so native reads the
// file as base64 and decodes it to an ArrayBuffer instead.
export async function uploadAvatar(userId, uri) {
  const path = avatarPath(userId);

  if (Platform.OS === "web") {
    const blob = await fetch(uri).then((res) => res.blob());
    const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
  } else {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    const { error } = await supabase.storage.from("avatars").upload(path, decode(base64), { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
  }

  const { data: signed, error: signErr } = await supabase.storage.from("avatars").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr) throw signErr;

  // Each upload mints a fresh token, so the URL string itself is already
  // unique per upload — that alone cache-busts any Image component keyed on
  // the uri (screens additionally key their Avatar on this string to force
  // an immediate remount). Not appending our own query param here since
  // Storage's signature check is over the token, not the full request URL.
  const { error: updateErr } = await supabase.from("profiles").update({ avatar_url: signed.signedUrl }).eq("id", userId);
  if (updateErr) throw updateErr;

  return signed.signedUrl;
}

export async function removeAvatar(userId) {
  const { error: removeErr } = await supabase.storage.from("avatars").remove([avatarPath(userId)]);
  if (removeErr) throw removeErr;

  const { error: updateErr } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
  if (updateErr) throw updateErr;
}

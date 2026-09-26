import { supabase } from "../supabaseClient.js";

// DB enums are snake_case; the UI uses display labels. "FA President Only"
// can't be produced by dbStatusToLabel (it'd give "Fa President Only"), so
// the audience/category maps are explicit in both directions.
export const CATEGORIES = ["General", "Distribution Schedule", "Validation Reminder", "Urgent"];
export const AUDIENCES = ["All Farmers", "Validated Farmers Only", "FA President Only"];

const CATEGORY_TO_DB = { General: "general", "Distribution Schedule": "distribution_schedule", "Validation Reminder": "validation_reminder", Urgent: "urgent" };
const AUDIENCE_TO_DB = { "All Farmers": "all_farmers", "Validated Farmers Only": "validated_farmers_only", "FA President Only": "fa_president_only" };
const invert = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));
const CATEGORY_FROM_DB = invert(CATEGORY_TO_DB);
const AUDIENCE_FROM_DB = invert(AUDIENCE_TO_DB);

export const MAX_TITLE = 150;
export const MAX_BODY = 2000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BUCKET = "announcement-images";

// announcement_reads(count) embeds the number of farmers who've opened it
// (admin can read every receipt; see the RLS policy).
const SELECT = `
  announcement_id, title, body, category, target_audience, image_url, is_pinned, status,
  published_at, expires_at, created_by, created_at, updated_at,
  announcement_reads ( count )
`;

function mapAnnouncement(row) {
  return {
    id: row.announcement_id,
    title: row.title,
    body: row.body,
    category: CATEGORY_FROM_DB[row.category] ?? row.category,
    audience: AUDIENCE_FROM_DB[row.target_audience] ?? row.target_audience,
    imagePath: row.image_url,
    isPinned: row.is_pinned,
    status: row.status === "published" ? "Published" : "Draft",
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expired: !!row.expires_at && new Date(row.expires_at) <= new Date(),
    readCount: row.announcement_reads?.[0]?.count ?? 0,
  };
}

export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select(SELECT)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapAnnouncement);
}

export function validateImageFile(file) {
  if (!file.type.startsWith("image/")) return "Please choose an image file (PNG, JPG, WebP…).";
  if (file.size > MAX_IMAGE_BYTES) return "Image must be 5 MB or smaller.";
  return null;
}

async function uploadImage(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "jpg"}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

async function removeImage(path) {
  if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}

export async function getAnnouncementImageUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// `status` is "Draft" | "Published". published_at is stamped by a database
// trigger the moment a post becomes Published, never sent from here.
function toDbFields({ title, body, category, audience, isPinned, expiresAt, status }) {
  return {
    title: title.trim(),
    body: body.trim(),
    category: CATEGORY_TO_DB[category],
    target_audience: AUDIENCE_TO_DB[audience],
    is_pinned: !!isPinned,
    expires_at: expiresAt || null,
    status: status === "Published" ? "published" : "draft",
  };
}

export async function createAnnouncement(fields, imageFile) {
  const { data: auth } = await supabase.auth.getUser();
  const imagePath = imageFile ? await uploadImage(imageFile) : null;
  const { data, error } = await supabase
    .from("announcements")
    .insert({ ...toDbFields(fields), image_url: imagePath, created_by: auth?.user?.id ?? null })
    .select(SELECT)
    .single();
  if (error) {
    await removeImage(imagePath);
    throw error;
  }
  return mapAnnouncement(data);
}

// imageFile: a new File to replace the image; removeCurrentImage: drop it
// without a replacement. The old object is deleted only after the row
// update succeeds, so a failed save never orphans the post's image.
export async function updateAnnouncement(id, fields, { imageFile, removeCurrentImage, currentImagePath } = {}) {
  let imagePath = currentImagePath ?? null;
  let uploaded = null;
  if (imageFile) {
    uploaded = await uploadImage(imageFile);
    imagePath = uploaded;
  } else if (removeCurrentImage) {
    imagePath = null;
  }

  const { data, error } = await supabase
    .from("announcements")
    .update({ ...toDbFields(fields), image_url: imagePath })
    .eq("announcement_id", id)
    .select(SELECT)
    .maybeSingle();
  if (error || !data) {
    await removeImage(uploaded);
    if (error) throw error;
    throw new Error("Couldn't save this announcement — refresh and try again.");
  }
  if (currentImagePath && currentImagePath !== imagePath) await removeImage(currentImagePath);
  return mapAnnouncement(data);
}

async function patch(id, values) {
  const { data, error } = await supabase.from("announcements").update(values).eq("announcement_id", id).select(SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't update this announcement — refresh and try again.");
  return mapAnnouncement(data);
}

export const setAnnouncementStatus = (id, status) => patch(id, { status: status === "Published" ? "published" : "draft" });
export const setAnnouncementPinned = (id, isPinned) => patch(id, { is_pinned: isPinned });

export async function deleteAnnouncement(id, imagePath) {
  const { data, error } = await supabase.from("announcements").delete().eq("announcement_id", id).select("announcement_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't delete this announcement — refresh and try again.");
  await removeImage(imagePath);
}

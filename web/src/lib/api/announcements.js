import { supabase } from "../supabaseClient.js";

// Announcements are simple posts by "MAO Labangan": text (up to 2,000
// characters) with an optional photo, posted to an audience, pinned or not.
// The old structured fields (title, date, venue, …) stay in the database but
// aren't used; title is kept as the post's first line by the database.
export const AUDIENCES = [
  { value: "farmers", label: "All farmers" },
  { value: "fa_president", label: "Farmers' Association President" },
  { value: "everyone", label: "Everyone" },
];
export const audienceLabel = (value) => AUDIENCES.find((a) => a.value === value)?.label ?? "All farmers";

export const MAX_BODY = 2000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BUCKET = "announcement-images";

// announcement_reads(count) embeds the number of farmers who've opened it
// (admin can read every receipt; see the RLS policy).
const SELECT = `
  announcement_id, title, body, audience, image_url, is_pinned, status,
  forwarded_by, forwarded_at, published_at, created_by, created_at, updated_at,
  announcement_reads ( count )
`;

// The first non-empty line of a post (or "Photo" for a photo-only post).
export function firstLine(body) {
  return String(body ?? "").split("\n").map((l) => l.trim()).find(Boolean) || "Photo";
}

function mapAnnouncement(row) {
  return {
    id: row.announcement_id,
    body: row.body ?? "",
    firstLine: firstLine(row.body),
    audience: row.audience,
    audienceLabel: audienceLabel(row.audience),
    imagePath: row.image_url,
    isPinned: row.is_pinned,
    // A draft from before posts (never shown to farmers until it's posted).
    isDraft: row.status !== "published",
    forwardedAt: row.forwarded_at,
    postedAt: row.published_at ?? row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readCount: row.announcement_reads?.[0]?.count ?? 0,
  };
}

export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select(SELECT)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapAnnouncement);
}

// Forwarding doesn't return the row (RPC is void) — refetch the one
// announcement so the caller gets a normal mapped object back to patch
// into its list, same shape as create/update/patch.
export async function forwardAnnouncementToFarmers(id) {
  const { error } = await supabase.rpc("forward_announcement_to_farmers", { p_announcement_id: id });
  if (error) throw error;
  const { data, error: fetchErr } = await supabase.from("announcements").select(SELECT).eq("announcement_id", id).single();
  if (fetchErr) throw fetchErr;
  return mapAnnouncement(data);
}

// The types the announcement-images bucket accepts (it refuses others too).
export const IMAGE_TYPES = ["image/jpeg", "image/png"];

// How each allowed type's file starts. A file's type comes from its name, so
// a program renamed photo.jpg still says image/jpeg — its bytes don't.
const SIGNATURES = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
];

async function looksLikeImage(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return SIGNATURES.some((sig) => sig.every((byte, i) => head[i] === byte));
}

export async function validateImageFile(file) {
  if (!IMAGE_TYPES.includes(file.type)) return "Choose a JPG or PNG photo.";
  if (file.size > MAX_IMAGE_BYTES) return "The photo must be 5 MB or smaller.";
  if (!(await looksLikeImage(file))) return "That file isn't a real photo. Choose a JPG or PNG.";
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

// A post: { body, audience, isPinned }. Saving always posts it (a draft
// from before is posted when it's saved); published_at is stamped by the
// database the moment a post goes up.
function toDbFields({ body, audience, isPinned }) {
  return {
    body: body.trim(),
    audience,
    is_pinned: !!isPinned,
    status: "published",
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

export const setAnnouncementPinned = (id, isPinned) => patch(id, { is_pinned: isPinned });

// Deleting hides the post from everyone (deleted_at); the record and its
// photo are kept.
export async function deleteAnnouncement(id) {
  const { data, error } = await supabase.from("announcements").update({ deleted_at: new Date().toISOString() }).eq("announcement_id", id).select("announcement_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Couldn't delete this announcement — refresh and try again.");
}

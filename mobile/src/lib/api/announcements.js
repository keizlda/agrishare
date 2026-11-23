import { supabase } from "../supabaseClient";

// Announcements are simple posts by "MAO Labangan": text with an optional
// photo. RLS already limits rows to published, not-deleted posts aimed at
// this farmer, and the embedded announcement_reads only ever contains this
// farmer's own receipt — so a non-empty array = read.
const SELECT = `
  announcement_id, body, image_url, is_pinned, published_at, created_at, forwarded_at,
  announcement_reads ( read_at )
`;

// The first non-empty line of a post (or "Photo" for a photo-only post).
export function firstLine(body) {
  const line = String(body ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  return line || "Photo";
}

function mapAnnouncement(row) {
  return {
    id: row.announcement_id,
    body: row.body ?? "",
    firstLine: firstLine(row.body),
    imagePath: row.image_url,
    isPinned: row.is_pinned,
    postedAt: row.published_at ?? row.created_at,
    read: (row.announcement_reads ?? []).length > 0,
    wasForwarded: !!row.forwarded_at,
  };
}

// Pinned first, then newest.
export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select(SELECT)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false });
  if (error) throw error;
  return data.map(mapAnnouncement);
}

// Idempotent: the (announcement_id, farmer_id) primary key + ignoreDuplicates
// means re-opening a post never errors or moves its original read time.
export async function markAnnouncementRead(announcementId, farmerId) {
  const { error } = await supabase
    .from("announcement_reads")
    .upsert({ announcement_id: announcementId, farmer_id: farmerId }, { onConflict: "announcement_id,farmer_id", ignoreDuplicates: true });
  if (error) throw error;
}

// Signed photo URLs, kept for a while so lists don't ask again on every render.
const urlCache = new Map();
export async function getAnnouncementImageUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from("announcement-images").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, until: Date.now() + (expiresInSeconds - 60) * 1000 });
  return data.signedUrl;
}

// Fires `onChange` whenever a post is added, edited, pinned/unpinned or
// deleted. Realtime applies the table's SELECT policies per subscriber, so a
// farmer is only notified about posts they can read; the caller just
// refetches. Returns an unsubscribe function.
export function subscribeToAnnouncements(onChange) {
  const channel = supabase
    .channel(`announcements-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

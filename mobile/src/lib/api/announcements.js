import { supabase } from "../supabaseClient";

// Announcements are posts by "MAO Labangan": a title, an optional date,
// time and venue, details and a photo. RLS already limits rows to published,
// not-deleted posts meant for this farmer (farmers, in their barangay or all
// barangays), and the embedded announcement_reads only ever contains this
// farmer's own receipt — so a non-empty array = read.
const SELECT = `
  announcement_id, title, body, distribution_date, distribution_time, venue,
  audience, all_barangays, barangay_ids, image_url, is_pinned, published_at, created_at, forwarded_at,
  announcement_reads ( read_at ),
  linked_distribution_id, target_farmer_ids,
  distribution:distribution_events!announcements_linked_distribution_id_fkey ( program_name )
`;

// "Farmers", "Farmers' Association Presidents" or both.
function audienceLabel(audience) {
  const farmers = audience === "farmers" || audience === "everyone";
  const fa = audience === "fa_president" || audience === "everyone";
  return [farmers && "Farmers", fa && "Farmers' Association Presidents"].filter(Boolean).join(" / ");
}

function mapAnnouncement(row, barangayName) {
  const allBarangays = row.all_barangays !== false;
  return {
    id: row.announcement_id,
    title: row.title ?? "",
    body: row.body ?? "",
    date: row.distribution_date ?? "",
    time: row.distribution_time ? row.distribution_time.slice(0, 5) : "",
    venue: row.venue ?? "",
    audienceLabel: audienceLabel(row.audience),
    // A distribution's schedule (for its farmers): the program.
    program: row.linked_distribution_id ? row.distribution?.program_name ?? "a distribution" : "",
    allBarangays,
    barangayNames: allBarangays ? [] : (row.barangay_ids ?? []).map((id) => barangayName.get(Number(id)) ?? "Barangay").sort((a, b) => a.localeCompare(b)),
    imagePath: row.image_url,
    isPinned: row.is_pinned,
    postedAt: row.published_at ?? row.created_at,
    read: (row.announcement_reads ?? []).length > 0,
    wasForwarded: !!row.forwarded_at,
  };
}

// Barangay names by id (the list in Settings → Lists), kept for a while.
let barangayCache = { until: 0, map: new Map() };
async function barangayNames() {
  if (barangayCache.until > Date.now()) return barangayCache.map;
  const { data, error } = await supabase.from("barangays").select("id, name");
  if (error) return barangayCache.map;
  barangayCache = { until: Date.now() + 10 * 60 * 1000, map: new Map(data.map((b) => [Number(b.id), b.name])) };
  return barangayCache.map;
}

// Pinned first, then newest.
export async function listAnnouncements() {
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from("announcements")
      .select(SELECT)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false }),
    barangayNames(),
  ]);
  if (error) throw error;
  return data.map((row) => mapAnnouncement(row, names));
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

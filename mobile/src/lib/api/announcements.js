import { supabase } from "../supabaseClient";

// RLS already limits rows to published posts aimed at this farmer (recipient
// booleans + validation status), and the embedded announcement_reads only
// ever contains this farmer's own receipt — so a non-empty array = read.
const SELECT = `
  announcement_id, title, body, image_url, is_pinned, published_at, created_at,
  distribution_date, distribution_time, venue, assistance_type, requirements, linked_distribution_id,
  forwarded_at, announcement_reads ( read_at )
`;

function mapAnnouncement(row) {
  const posted = new Date(row.published_at ?? row.created_at);
  return {
    id: row.announcement_id,
    title: row.title,
    body: row.body,
    imagePath: row.image_url,
    isPinned: row.is_pinned,
    postedAt: posted.toISOString(),
    date: posted.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    read: (row.announcement_reads ?? []).length > 0,
    distributionDate: row.distribution_date,
    distributionTime: row.distribution_time,
    venue: row.venue,
    assistanceType: row.assistance_type,
    requirements: row.requirements,
    linkedDistributionId: row.linked_distribution_id,
    isGeneralNotice: !row.distribution_date,
    wasForwarded: !!row.forwarded_at,
  };
}

// Used by the detail sheet to show "You are included in this distribution" —
// RLS already scopes distribution_claims to this farmer's own rows, so a
// non-empty result means this specific farmer, not just any farmer, is
// tagged in the linked distribution.
export async function isTaggedInDistribution(eventId) {
  if (!eventId) return false;
  const { data, error } = await supabase.from("distribution_claims").select("claim_id").eq("event_id", eventId).limit(1);
  if (error) throw error;
  return data.length > 0;
}

// Pinned first, then newest.
export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select(SELECT)
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

export async function getAnnouncementImageUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("announcement-images").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Fires `onChange` whenever a post is added, edited, pinned/unpinned,
// unpublished or deleted. Realtime applies the table's SELECT policies per
// subscriber, so a farmer is only notified about posts they can read; the
// caller just refetches. Returns an unsubscribe function.
export function subscribeToAnnouncements(onChange) {
  const channel = supabase
    .channel(`announcements-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

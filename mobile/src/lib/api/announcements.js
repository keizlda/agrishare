import { supabase } from "../supabaseClient";

const CATEGORY_LABELS = {
  general: "General",
  distribution_schedule: "Distribution Schedule",
  validation_reminder: "Validation Reminder",
  urgent: "Urgent",
};

// RLS already limits rows to published, unexpired posts aimed at this farmer
// (audience + validation status), and the embedded announcement_reads only
// ever contains this farmer's own receipt — so a non-empty array = read.
const SELECT =
  "announcement_id, title, body, category, image_url, is_pinned, published_at, created_at, expires_at, announcement_reads ( read_at )";

function mapAnnouncement(row) {
  const posted = new Date(row.published_at ?? row.created_at);
  return {
    id: row.announcement_id,
    title: row.title,
    body: row.body,
    category: CATEGORY_LABELS[row.category] ?? "General",
    imagePath: row.image_url,
    isPinned: row.is_pinned,
    postedAt: posted.toISOString(),
    date: posted.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    expiresAt: row.expires_at,
    read: (row.announcement_reads ?? []).length > 0,
  };
}

// Pinned first, then newest.
export async function listAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select(SELECT)
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false });
  if (error) throw error;
  const now = Date.now();
  return data.map(mapAnnouncement).filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now);
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

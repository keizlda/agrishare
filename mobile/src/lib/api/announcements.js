import { supabase } from "../supabaseClient";

const SELECT = "notification_id, title, message, created_at, notification_reads!left(read_at, archived)";

// notification_reads!left filtered by profile_id scopes the embedded array to
// just this farmer's own read/archived row (0 or 1 entries), without
// dropping notifications that farmer hasn't touched yet (a plain inner join
// would hide every unread notification).
function mapAnnouncement(row, profileId) {
  const myRead = (row.notification_reads ?? []).find(() => true);
  const created = new Date(row.created_at);
  return {
    id: row.notification_id,
    title: row.title,
    body: row.message,
    date: created.toISOString().slice(0, 10),
    time: created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    isNew: !myRead,
    read: !!myRead,
    archived: myRead?.archived ?? false,
    _profileId: profileId,
  };
}

export async function listAnnouncements(profileId) {
  const { data, error } = await supabase
    .from("notifications")
    .select(SELECT)
    .eq("notification_reads.profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => mapAnnouncement(row, profileId));
}

export async function markAnnouncementRead(notificationId, profileId) {
  const { error } = await supabase
    .from("notification_reads")
    .upsert({ notification_id: notificationId, profile_id: profileId, read_at: new Date().toISOString() }, { onConflict: "notification_id,profile_id", ignoreDuplicates: false });
  if (error) throw error;
}

export async function setAnnouncementArchived(notificationId, profileId, archived) {
  const { error } = await supabase
    .from("notification_reads")
    .upsert(
      { notification_id: notificationId, profile_id: profileId, read_at: new Date().toISOString(), archived },
      { onConflict: "notification_id,profile_id", ignoreDuplicates: false },
    );
  if (error) throw error;
}

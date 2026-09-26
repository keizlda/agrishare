import { supabase } from "../supabaseClient";

// user_notifications is scoped to the signed-in user by RLS — rows created by
// DB triggers when e.g. a crop validation is reviewed. No user filter needed.
const COLUMNS = "id, type, title, message, link, is_read, created_at";

function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

export async function listMyNotifications(limit = 50) {
  const { data, error } = await supabase.from("user_notifications").select(COLUMNS).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map(mapNotification);
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("user_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.from("user_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("is_read", false);
  if (error) throw error;
}

export async function deleteNotification(id) {
  const { error } = await supabase.from("user_notifications").delete().eq("id", id);
  if (error) throw error;
}

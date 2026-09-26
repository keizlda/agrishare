import { supabase } from "../supabaseClient.js";

// user_notifications is scoped by RLS to auth.uid() (see the migration), so
// none of these need an explicit user filter — another user's rows simply
// never come back and can't be updated or deleted.
const COLUMNS = "id, type, title, message, link, is_read, read_at, created_at";

function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// Newest first, offset-paginated. Fetches one extra row to know if there's
// another page without a separate count query.
export async function listNotifications({ limit = 20, offset = 0, unreadOnly = false } = {}) {
  let query = supabase.from("user_notifications").select(COLUMNS).order("created_at", { ascending: false }).range(offset, offset + limit);
  if (unreadOnly) query = query.eq("is_read", false);
  const { data, error } = await query;
  if (error) throw error;
  return { items: data.slice(0, limit).map(mapNotification), hasMore: data.length > limit };
}

export async function getUnreadCount() {
  const { count, error } = await supabase.from("user_notifications").select("id", { count: "exact", head: true }).eq("is_read", false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("user_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function markNotificationUnread(id) {
  const { error } = await supabase.from("user_notifications").update({ is_read: false, read_at: null }).eq("id", id);
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

export async function clearReadNotifications() {
  const { error } = await supabase.from("user_notifications").delete().eq("is_read", true);
  if (error) throw error;
}

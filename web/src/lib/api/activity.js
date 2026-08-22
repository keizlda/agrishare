import { supabase } from "../supabaseClient.js";

// audit_logs is written by the log_audit_event() trigger on farmers/
// distribution_claims/requests — reusing it here means the notification
// bell reflects real writes instead of a fake, static list. RLS restricts
// audit_logs to MAO Admin, so FA President sessions will just see an empty list.
const DESCRIPTIONS = {
  "farmers.INSERT": "New farmer registered",
  "farmers.UPDATE": "Farmer record updated",
  "farmers.DELETE": "Farmer record removed",
  "distribution_claims.INSERT": "Commodity distributed to a farmer",
  "requests.INSERT": "New commodity request submitted",
  "requests.UPDATE": "Commodity request status changed",
};

function timeAgo(isoString) {
  const seconds = Math.max(0, (Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export async function listRecentActivity(limit = 5) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("log_id, table_name, action, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((row) => ({
    id: row.log_id,
    title: DESCRIPTIONS[`${row.table_name}.${row.action}`] ?? `${row.table_name} ${row.action.toLowerCase()}d`,
    time: timeAgo(row.created_at),
  }));
}

import { supabase } from "../supabaseClient.js";

// Every table that carries a `log_audit_event()` trigger (Phase 1) — the
// dropdown filter only lists what could actually show up.
export const ENTITY_TYPES = [
  "farmers",
  "distribution_events",
  "distribution_event_items",
  "distribution_claims",
  "commodities",
  "announcements",
  "requests",
  "crop_validations",
];

export const ENTITY_LABELS = {
  farmers: "Farmers",
  distribution_events: "Distributions",
  distribution_event_items: "Distribution Items",
  distribution_claims: "Beneficiaries",
  commodities: "Commodities",
  announcements: "Announcements",
  requests: "Requests",
  crop_validations: "Farmer Validation",
};

export const ACTION_TYPES = ["insert", "update", "delete"];
export const ACTION_LABELS = { insert: "Created", update: "Updated", delete: "Deleted" };

const ROLE_LABELS = { mao_admin: "MAO Admin", fa_president: "Farmers' Association President", farmer: "Farmer" };

const SELECT = "log_id, table_name, action, record_id, summary, user_role, created_at, profiles ( full_name )";

function mapLog(row) {
  return {
    id: row.log_id,
    entityType: row.table_name,
    entityLabel: ENTITY_LABELS[row.table_name] ?? row.table_name,
    action: row.action,
    actionLabel: ACTION_LABELS[row.action] ?? row.action,
    recordId: row.record_id,
    summary: row.summary,
    userName: row.profiles?.full_name ?? "System",
    userRole: ROLE_LABELS[row.user_role] ?? row.user_role ?? "—",
    createdAt: row.created_at,
  };
}

const PAGE_SIZE = 25;

// pageSize: rows per page (the Activity Log page passes however many fit on
// screen). dateFrom/dateTo: "YYYY-MM-DD" strings from a date input, inclusive on both
// ends (dateTo gets bumped to the start of the next day since created_at is
// a timestamp). They're Philippine days, matching the times the log shows.
// entityType/action: "All" or one of the *_TYPES above.
const startOfManilaDay = (day) => new Date(`${day}T00:00:00+08:00`);

export async function listAuditLogs({ dateFrom, dateTo, action = "All", entityType = "All", page = 1, pageSize = PAGE_SIZE } = {}) {
  let query = supabase.from("audit_logs").select(SELECT, { count: "exact" }).order("created_at", { ascending: false });

  if (dateFrom) query = query.gte("created_at", startOfManilaDay(dateFrom).toISOString());
  if (dateTo) {
    const next = startOfManilaDay(dateTo);
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt("created_at", next.toISOString());
  }
  if (action !== "All") query = query.eq("action", action);
  if (entityType !== "All") query = query.eq("table_name", entityType);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data.map(mapLog), total: count ?? 0, pageSize };
}

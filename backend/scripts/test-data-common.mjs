// Shared by seed-test-data.mjs and cleanup-test-data.mjs.
//
// Both run locally only, with the service role key from backend/.env.seed
// (gitignored by `.env.*`; never commit it). The ledger file records the ID of
// every row, account and file the seed created, so cleanup removes exactly
// those and nothing else. It holds IDs only, no secrets, so it is committed.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const BATCH = "test-2026-10";
export const HERE = import.meta.dirname;
export const ROOT = path.resolve(HERE, "../..");
export const DATA_FILE = path.join(ROOT, "agrishare-test-data.json");
export const LEDGER_FILE = path.join(HERE, "test-data.ledger.json");
const ENV_FILE = path.resolve(HERE, "../.env.seed");

// Tables with the generic audit trigger, and the key that identifies a row
// inside audit_logs.details (record_id alone is ambiguous: for
// crop_validations it holds the farmer_id).
export const AUDITED = {
  farmers: "farmer_id",
  commodities: "commodity_id",
  distribution_events: "event_id",
  distribution_event_items: "event_item_id",
  distribution_claims: "claim_id",
  crop_validations: "validation_id",
  requests: "request_id",
  announcements: "announcement_id",
};

export function adminClient() {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`Missing ${ENV_FILE} (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).`);
  const env = Object.fromEntries(
    fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(`${ENV_FILE} needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout },
  });
}

// A stalled connection must not hang the run forever: every request gets a
// timeout, and reads (GET/HEAD) are retried. Writes are not retried here —
// the scripts are idempotent, so a failed write is simply re-run. Auth admin
// calls on a single user can take well over 10s when the Auth service is
// busy, so they get a longer window.
async function fetchWithTimeout(input, init = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" || method === "HEAD" ? 3 : 1;
  const url = typeof input === "string" ? input : input.url;
  const timeout = /\/auth\/v1\/admin\/users\/[^/?]+/.test(url) ? 120_000 : 30_000;
  for (let i = 1; ; i++) {
    try {
      return await fetch(input, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      if (i >= attempts) throw err;
    }
  }
}

export function emptyLedger() {
  return {
    batch: BATCH,
    note: "Rows/accounts/files created by backend/scripts/seed-test-data.mjs. Removed by cleanup-test-data.mjs.",
    authUsers: [], farmers: [], addresses: [], farmParcels: [], crops: [], commodities: [],
    events: [], eventItems: [], claims: [], cropValidations: [], requests: [], announcements: [],
    notifications: [], auditLogs: [], storage: [],
  };
}

export function loadLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return emptyLedger();
  return { ...emptyLedger(), ...JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")) };
}

export function saveLedger(ledger) {
  fs.writeFileSync(LEDGER_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
}

// Appends to a ledger list unless an entry with the same key is already there.
export function remember(list, entry, key) {
  const k = key ? entry[key] : entry;
  if (!list.some((e) => (key ? e[key] : e) === k)) list.push(entry);
}

export async function must(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

export async function listAllUsers(sb) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

export function chunk(list, size = 100) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// A stop is not a failure to retry: something would modify or delete a real
// record, so the run halts and explains instead.
export class StopError extends Error {}

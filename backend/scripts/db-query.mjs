#!/usr/bin/env node
// Runs one SQL statement against the live AgriShare database through the
// Supabase Management API and prints the JSON result. Lets Claude (or you)
// check live data without pasting SQL into the dashboard.
//
// Usage (from the repo root):
//   node backend/scripts/db-query.mjs "select role, count(*) from profiles group by role"
//
// Reads SUPABASE_ACCESS_TOKEN from .env.deploy (gitignored). The token is
// never printed. Schema changes belong in supabase/migrations + `db push`,
// not here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PROJECT_REF = "bofvqdywhyrlbzatvxve";

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: node backend/scripts/db-query.mjs "<sql>"');
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  try {
    const env = readFileSync(resolve(repoRoot, ".env.deploy"), "utf8");
    token = env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim();
  } catch {
    // handled below
  }
}
if (!token) {
  console.error("No SUPABASE_ACCESS_TOKEN found in the environment or .env.deploy.");
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
let out;
try {
  out = JSON.stringify(JSON.parse(text), null, 2);
} catch {
  out = text;
}
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${out}`);
  process.exit(1);
}
console.log(out);

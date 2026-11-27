// Gives every barangay without a Farmers' Association President its own
// president account (Nov 28, 2026):
//
//   node backend/scripts/create-fa-presidents.mjs            development database
//   node backend/scripts/create-fa-presidents.mjs --dry-run  only list what it would make
//   add --live for the live project (only when the owner says "deploy to live")
//
// Each account: "FA President – <Barangay>" (the MAO Admin puts in the real
// name later: Settings → Farmers' Association Presidents → Edit), signs in
// with fapresident@<barangay>.gov.ph (like Langapod's
// fapresident@langapud.gov.ph) and a temporary password of its own, which
// they're asked to change after signing in. Barangays that already have a
// president are left alone, so running it again only fills the gaps.
//
// The sign-in list (with the temporary passwords) is written to
// fa-president-logins.dev.csv, or fa-president-logins.csv for live — both
// gitignored. Give each president theirs in person.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const DEV_REF = "peyyzxbjcugyqfdrrlyz";
const LIVE_REF = "bofvqdywhyrlbzatvxve";
const LIVE = process.argv.includes("--live");
const DRY = process.argv.includes("--dry-run");
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, "..", LIVE ? ".env.seed" : ".env.seed.dev");
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!String(env.SUPABASE_URL).includes(LIVE ? LIVE_REF : DEV_REF)) {
  console.error(`Stopped: ${envFile} isn't the ${LIVE ? "live" : "development"} project.`);
  process.exit(1);
}
console.log(`Target: ${LIVE ? "LIVE project" : "development database (agrishare-dev)"}${DRY ? " — dry run" : ""}`);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOGINS = path.join(here, LIVE ? "fa-president-logins.csv" : "fa-president-logins.dev.csv");

// "Lower Campo Islam (Poblacion)" -> "lowercampoislam"; "Sang-an" -> "sangan".
const slug = (name) => name.replace(/\(.*?\)/g, "").toLowerCase().replace(/[^a-z]/g, "");
// 12 characters without look-alikes (as the account function makes them).
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join("");
}
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const { data: barangays, error: bErr } = await sb.from("barangays").select("id, name").eq("is_active", true).order("name");
if (bErr) throw bErr;
const { data: presidents, error: pErr } = await sb.from("profiles").select("barangay_id").eq("role", "fa_president");
if (pErr) throw pErr;
const covered = new Set(presidents.map((p) => Number(p.barangay_id)));
const todo = barangays.filter((b) => !covered.has(Number(b.id)));
console.log(`${barangays.length} barangays; ${barangays.length - todo.length} already have a president; ${todo.length} to make.`);

const made = [];
for (const b of todo) {
  const email = `fapresident@${slug(b.name)}.gov.ph`;
  const fullName = `FA President – ${b.name}`;
  if (DRY) {
    console.log(`  would make ${email}  (${fullName})`);
    continue;
  }
  const password = temporaryPassword();
  const { data: created, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, contact_no: null },
    app_metadata: { role: "fa_president", barangay_id: b.id },
  });
  if (error || !created?.user) {
    console.log(`  SKIPPED ${b.name}: ${error?.message ?? "no account made"}`);
    continue;
  }
  const id = created.user.id;
  // A temporary password: they're asked to change it.
  await sb.from("profiles").update({ must_change_password: true }).eq("id", id);
  await sb.from("audit_logs").insert({
    actor_id: null, user_role: "mao_admin", table_name: "profiles", action: "insert", record_id: id,
    summary: `Farmers' Association President account created: ${fullName} (Barangay ${b.name})`,
    changes: { new: { full_name: fullName, email, barangay_id: b.id } }, details: { id }, barangay_id: b.id,
  });
  made.push({ barangay: b.name, name: fullName, email, password, id });
  console.log(`  made ${email}`);
}

if (made.length) {
  const header = "Barangay,Name,Email (sign-in),Temporary password,Account id\n";
  const lines = made.map((m) => [m.barangay, m.name, m.email, m.password, m.id].map(csv).join(",")).join("\n") + "\n";
  if (fs.existsSync(LOGINS)) fs.appendFileSync(LOGINS, lines);
  else fs.writeFileSync(LOGINS, header + lines);
  console.log(`\n${made.length} accounts made. Sign-in list: ${LOGINS}`);
}

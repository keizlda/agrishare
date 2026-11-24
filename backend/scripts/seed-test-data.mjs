// Loads agrishare-test-data.json (project root) into the Supabase project.
//
//   cd backend
//   node scripts/seed-test-data.mjs --dry-run   # look up everything, write nothing
//   node scripts/seed-test-data.mjs             # seed (safe to re-run)
//
// Idempotent: every item is matched on its natural key first (RSBSA number,
// commodity name, program name + date, farmer + submitted time, farmer +
// commodity + request date, announcement title, login email), so a re-run
// inserts nothing and fires no notifications. Every created row, account,
// notification, audit entry and file is recorded in test-data.ledger.json
// for cleanup-test-data.mjs.
//
// Never touches existing records: Maui Pelaez, Claude Oclarit and Luna Cuizon
// (and any other real farmer, commodity or distribution) are only looked up
// and referenced. If a seeded key ever matches a real record, the run stops.
//
// Notifications come from the database's own triggers: each item is written
// the way the apps write it (a submission is inserted pending, then
// reviewed; a request goes pending -> forwarded -> decided; beneficiaries are
// tagged onto a distribution), and the resulting notifications are backdated
// to when that step "happened".
//
// Review suggestions (Nov 2026): commodities carry an allocation per hectare
// (Rice Seeds 40 kg/ha in 20 kg bags, Hybrid Rice Seeds 15 kg/ha); one
// distribution's quantities follow farm size × allocation (one adjusted, with
// its reason); the FA President files requests on farmers' behalf (Maui,
// Claude, Luna and a seeded farmer — new request rows that only reference
// them). (It also sent association requests until those were removed from
// the apps on Nov 23, 2026: none are seeded now; older seeded ones stay in
// the ledger so cleanup-test-data.mjs can remove them.)
//
// MAO presentation (Nov 22–23, 2026): one allocation (kg per hectare) per
// commodity — varieties are separate commodities (Rice Seeds – Inbred (RCEF)
// 40, Rice Seeds – Hybrid 15, made by the 20261123 migration from the old
// types; reused, never changed) — each seeded farmer's Seed program,
// requests that go straight to the MAO (Pending, some Recommended by the
// Farmers' Association President, Approved, Rejected), distributions by
// farm size × the commodity's rate (one with a 2,000 kg barangay
// allocation), harvest reports in kg
// (Submitted, Verified, Returned; Maui, Claude and Luna only as new rows),
// and the default-password reminder turned off for the seeded (evaluator)
// farmers.
//
// Managed lists (Nov 24, 2026): each seeded farmer's sitio/purok, farm
// location, crop and farmers' association are linked to the sitio, crop and
// association lists; the two test associations are added if missing
// (ledger: sitios / associations / cropTypes).
import sharp from "sharp";
import fs from "node:fs";
import {
  BATCH, DATA_FILE, LEDGER_FILE, AUDITED, StopError,
  adminClient, loadLedger, saveLedger, remember, must, listAllUsers, chunk,
} from "./test-data-common.mjs";

const DRY = process.argv.includes("--dry-run");
const sb = adminClient();
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const ledger = loadLedger();
const NOW = Date.now();

const EMAIL_DOMAIN = "farmers.agrishare.ph"; // same as manage-farmer-account
const AVATAR_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // same as mobile api/profile.js
const AVATAR_BG = "e3efe0,dff1ec,e3ecf8,fbefd9";
// ~5 seeded farmers keep the default icon so the fallback can be tested:
// login IDs ending in 0 or 5.
const NO_AVATAR = new Set(["000205", "000210", "000215", "000220", "000225"]);
const DEFAULT_REASON = "For the current planting season.";
const FA_FORWARD_REMARK = "Verified with the farmer; recommending approval.";
const GPS_ACCURACY_M = 8;
// When each announcement was posted (the JSON has no publish date).
const ANNOUNCEMENT_AT = {
  "RCEF wet season seed distribution on October 2": "2026-09-28T09:00:00+08:00",
  "Urea fertilizer distribution on October 23": "2026-10-14T09:00:00+08:00",
  "Submit proof of planting for the wet season": "2026-10-10T09:00:00+08:00",
  "FA meeting with the MAO": "2026-10-15T16:00:00+08:00",
  "Corn seed distribution in Bagalupa on December 3": "2026-11-20T09:00:00+08:00",
  "Bagalupa Farmers' Association Presidents' meeting": "2026-11-21T10:00:00+08:00",
  "Corn seed distribution in Bokong on December 2": "2026-11-22T09:00:00+08:00",
  "Combo Farmers' Association Presidents' planning meeting": "2026-11-22T13:00:00+08:00",
  "Fertilizer distribution in New Labangan and Bagalupa": "2026-11-23T08:30:00+08:00",
  "Typhoon preparedness reminder for all barangays": "2026-11-23T15:00:00+08:00",
};

const inserted = {};
const bump = (table, n = 1) => { inserted[table] = (inserted[table] ?? 0) + n; };
const notes = [];
const log = (...a) => console.log(...a);

// ---------- time helpers (all Philippine time, never later than now) ----------
const at = (date, hhmm) => `${date}T${hhmm}:00+08:00`;
function cap(iso) {
  const t = Math.min(new Date(iso).getTime(), NOW - 60_000);
  return new Date(t).toISOString();
}
function plusDays(iso, days, hhmm) {
  const d = new Date(new Date(iso).getTime() + days * 86_400_000);
  const local = new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  return at(local, hhmm);
}

// Farm size × allocation per hectare, capped, 2 decimals — the same rounding
// as commodity_allocation() in the database (worked in hundredths).
function allocationFor(commodity, farmSize) {
  const rate = Number(commodity?.allocation_per_hectare);
  if (!(rate > 0)) return null;
  let h = Math.round((Math.round(Number(farmSize) * 100) * Math.round(rate * 100)) / 100);
  if (Number(commodity.max_per_farmer) > 0) h = Math.min(h, Math.round(Number(commodity.max_per_farmer) * 100));
  return h / 100;
}

const loginIdFromRsbsa = (rsbsa) => rsbsa.replace(/\D/g, "").slice(-6);
const lower = (s) => s.toLowerCase();
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

async function maybeOne(query, what) {
  const rows = await must(query.limit(2), what);
  if (rows.length > 1) throw new Error(`${what}: expected at most one row, found ${rows.length}`);
  return rows[0] ?? null;
}

// ---------- notification capture ----------
let notifMark = 0;
async function captureNotifs(createdAt, titles) {
  if (DRY) return 0;
  const rows = await must(sb.from("user_notifications").select("id, title").gt("id", notifMark).order("id"), "read new notifications");
  if (rows.length) notifMark = rows.at(-1).id;
  const ours = rows.filter((r) => titles.includes(r.title));
  if (rows.length > ours.length) notes.push(`${rows.length - ours.length} unrelated notification(s) appeared during the run and were left alone.`);
  if (ours.length) {
    const ids = ours.map((r) => r.id);
    await must(sb.from("user_notifications").update({ created_at: cap(createdAt) }).in("id", ids), "backdate notifications");
    ids.forEach((id) => remember(ledger.notifications, id));
    bump("user_notifications", ids.length);
  }
  return ours.length;
}

// ---------- images ----------
async function renderAvatar(f) {
  const url = `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(f.rsbsa_number)}&size=512&backgroundColor=${AVATAR_BG}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`DiceBear HTTP ${res.status}`);
    const svg = Buffer.from(await res.arrayBuffer());
    const buf = await sharp(svg, { density: 144 }).resize(512, 512).flatten({ background: "#e3efe0" }).jpeg({ quality: 88 }).toBuffer();
    return { buf, source: "dicebear" };
  } catch (err) {
    // Offline fallback: 512x512 initials avatar.
    const palette = ["#4c9a5f", "#2a9d8f", "#4a7fc1", "#d99a2b"];
    const bg = palette[Number(f.login_id) % palette.length];
    const initials = `${f.first_name[0]}${f.last_name[0]}`.toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${bg}"/>` +
      `<text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="200" font-weight="600" fill="#ffffff">${initials}</text></svg>`;
    return { buf: await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer(), source: `initials (${err.message})` };
  }
}

// Harvest: the same field, golden, with its own caption.
async function renderHarvestPhoto(hr) {
  return renderPlaceholderPhoto(
    { farmer: hr.farmer, crop_type: `${hr.yield_kg.toLocaleString("en-US")} kg`, submitted_at: hr.harvest_date, latitude: hr.latitude, longitude: hr.longitude },
    { title: "SAMPLE HARVEST PHOTO · TEST DATA", field: ["#e2c15a", "#b48a2c"], rowColor: "#9c7424" },
  );
}

async function renderPlaceholderPhoto(s, look = {}) {
  const w = 1280, h = 960, horizon = 330;
  const [fieldTop, fieldBottom] = look.field ?? ["#8cc06a", "#4f8f37"];
  const rows = Array.from({ length: 15 }, (_, i) => {
    const x = (i - 7) * 190;
    return `<path d="M${w / 2 + x * 0.12} ${horizon} L${w / 2 + x * 1.6 - 40} ${h} L${w / 2 + x * 1.6 + 40} ${h} Z" fill="${look.rowColor ?? "#3f8f3a"}" opacity="0.55"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd0ef"/><stop offset="1" stop-color="#e6f3f8"/></linearGradient>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fieldTop}"/><stop offset="1" stop-color="${fieldBottom}"/></linearGradient></defs>
    <rect width="${w}" height="${horizon}" fill="url(#sky)"/><circle cx="1060" cy="120" r="56" fill="#ffe08a"/>
    <path d="M0 ${horizon} Q 320 ${horizon - 60} 640 ${horizon} T 1280 ${horizon} V ${horizon + 10} H 0 Z" fill="#6d9f55"/>
    <rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#field)"/>${rows}
    <rect y="${h - 170}" width="${w}" height="170" fill="#0b1f12" opacity="0.62"/>
    <text x="40" y="${h - 110}" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="700" fill="#ffffff">${look.title ?? "SAMPLE PROOF-OF-PLANTING PHOTO · TEST DATA"}</text>
    <text x="40" y="${h - 58}" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#e8f2ea">${xml(look.caption ?? `${s.farmer} · ${s.crop_type} · ${s.submitted_at.slice(0, 10)} · ${s.latitude}, ${s.longitude}`)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

// =============================================================================
async function main() {
  log(`${DRY ? "DRY RUN — nothing will be written. " : ""}Seeding ${BATCH} into Supabase…`);
  const users = await listAllUsers(sb);
  const userByEmail = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

  notifMark = (await must(sb.from("user_notifications").select("id").order("id", { ascending: false }).limit(1), "notification watermark"))[0]?.id ?? 0;
  const auditMark = (await must(sb.from("audit_logs").select("log_id").order("log_id", { ascending: false }).limit(1), "audit watermark"))[0]?.log_id ?? 0;

  // ---------- MAO Admin (existing; referenced as reviewer/author only) ----------
  const admins = await must(sb.from("profiles").select("id, full_name").eq("role", "mao_admin").order("created_at"), "MAO admins");
  if (!admins.length) throw new StopError("No MAO Admin account exists to act as reviewer.");
  const maoId = admins[0].id;
  log(`MAO Admin used as reviewer/author: ${admins[0].full_name} (${admins.length} admin account(s) found)`);

  // ---------- Existing farmers: look up only ----------
  const farmerByRsbsa = new Map();
  for (const e of data.existing_farmers_used) {
    const row = await maybeOne(sb.from("farmers").select("farmer_id, profile_id, first_name, surname, profiles!profile_id ( avatar_url )").eq("rsbsa_no", e.rsbsa_number).is("deleted_at", null), `existing farmer ${e.rsbsa_number}`);
    if (!row) throw new StopError(`Existing farmer ${e.first_name} ${e.last_name} (${e.rsbsa_number}) was not found. Not creating them.`);
    farmerByRsbsa.set(e.rsbsa_number, { id: row.farmer_id, profileId: row.profile_id, name: `${row.first_name} ${row.surname}`, existing: true });
    log(`Existing: ${row.first_name} ${row.surname} (farmer ${row.farmer_id}) — ${row.profiles?.avatar_url ? "has a picture, left as is" : "no picture (not adding one)"}`);
  }

  // ---------- Barangays (the list the migration seeds; never added here) ----------
  const barangayRows = await must(sb.from("barangays").select("id, name, former_names"), "barangays");
  const brgyKey = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, "");
  const barangayId = (name) => {
    const hit = barangayRows.find((b) => brgyKey(b.name) === brgyKey(name)) ?? barangayRows.find((b) => (b.former_names ?? []).some((f) => brgyKey(f) === brgyKey(name)));
    if (!hit) throw new StopError(`Barangay "${name}" isn't on the barangays list.`);
    return hit.id;
  };

  // ---------- FA President accounts (each in a barangay) ----------
  // The first is the one requests and harvest reports are filed by.
  let faId = null;
  for (const fa of [data.accounts.fa_president, ...(data.accounts.more_fa_presidents ?? [])]) {
    const faUser = userByEmail.get(fa.email.toLowerCase());
    if (faUser && faUser.app_metadata?.seed_batch !== BATCH) throw new StopError(`${fa.email} already exists and was not created by this seed.`);
    let id = faUser?.id ?? null;
    if (!faUser && !DRY) {
      const { data: created, error } = await sb.auth.admin.createUser({
        email: fa.email, password: fa.password, email_confirm: true,
        user_metadata: { full_name: fa.name },
        app_metadata: { seed_batch: BATCH, role: "fa_president", barangay_id: barangayId(fa.barangay) },
      });
      if (error) throw new Error(`create FA President: ${error.message}`);
      id = created.user.id;
      bump("auth.users (FA President)");
      bump("profiles");
    }
    if (id) {
      remember(ledger.authUsers, { id, email: fa.email }, "id");
      // Their barangay (only while it isn't set; one set in the app stays).
      if (fa.barangay && !DRY) {
        const set = await must(sb.from("profiles").update({ barangay_id: barangayId(fa.barangay) }).eq("id", id).is("barangay_id", null).select("id"), `barangay of ${fa.email}`);
        if (set.length) bump("profiles (FA President barangay)");
      }
    }
    faId ??= id;
    log(`FA President ${fa.name} (${fa.barangay ?? "no barangay"}): ${faUser ? "already seeded" : DRY ? "would create" : "created"}`);
  }
  if (!DRY) saveLedger(ledger);

  // ---------- Commodities: reuse by name, insert only missing ----------
  const commodityId = new Map();
  for (const c of data.commodities) {
    const name = c.name.replace(/[%_\\]/g, "\\$&");
    const row = await maybeOne(sb.from("commodities").select("commodity_id, name, category, unit, status, allocation_per_hectare, pack_size").ilike("name", name).is("deleted_at", null), `commodity ${c.name}`);
    if (row) {
      commodityId.set(c.name, row.commodity_id);
      const ours = ledger.commodities.some((x) => x.commodity_id === row.commodity_id);
      const num = (v) => (v == null ? null : Number(v));
      const diffs = [["category", row.category, c.category], ["unit", row.unit, c.unit], ["status", row.status, lower(c.status)],
        ["allocation per hectare", num(row.allocation_per_hectare), c.allocation_per_hectare ?? null], ["pack size", num(row.pack_size), c.pack_size ?? null]]
        .filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k} ${a} (JSON: ${b})`);
      if (!ours) log(`Commodity reused (existing, not modified): ${row.name}${diffs.length ? ` — differs: ${diffs.join(", ")}` : ""}`);
      continue;
    }
    // Deleted by the MAO Admin since an earlier run: that was their choice,
    // so it isn't re-created (its id still resolves for older records).
    const [deleted] = await must(sb.from("commodities").select("commodity_id").ilike("name", name).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(1), `deleted commodity ${c.name}`);
    if (deleted) {
      commodityId.set(c.name, deleted.commodity_id);
      log(`Commodity not re-created (deleted in the app): ${c.name}`);
      continue;
    }
    if (DRY) { log(`Commodity: would insert ${c.name}`); commodityId.set(c.name, `(new ${c.name})`); continue; }
    const ins = await must(sb.from("commodities").insert({
      name: c.name, category: c.category, unit: c.unit, status: lower(c.status),
      allocation_per_hectare: c.allocation_per_hectare ?? null, pack_size: c.pack_size ?? null, max_per_farmer: c.max_per_farmer ?? null,
    }).select("commodity_id").single(), `insert commodity ${c.name}`);
    commodityId.set(c.name, ins.commodity_id);
    remember(ledger.commodities, { commodity_id: ins.commodity_id, name: c.name }, "commodity_id");
    bump("commodities");
    log(`Commodity inserted: ${c.name}`);
  }
  if (!DRY) saveLedger(ledger);

  // One rate per commodity (20261123): a type an earlier run added to a real
  // commodity (Corn Seeds · Standard 20 kg/ha) became that commodity's rate.
  // Noted once so cleanup-test-data.mjs can take it off again (only while it
  // is still that rate — a rate the MAO set since is left alone).
  if (!DRY) {
    for (const t of ledger.commodityTypes) {
      const name = t.name.split(" · ")[0];
      const cid = commodityId.get(name);
      if (typeof cid !== "number" || ledger.commodities.some((x) => x.commodity_id === cid)) continue;
      if (ledger.rateRestores.some((x) => x.commodity_id === cid)) continue;
      const type = await maybeOne(sb.from("commodity_types").select("rate_kg_per_ha").eq("commodity_type_id", t.commodity_type_id), `type ${t.name}`);
      if (!type) continue;
      remember(ledger.rateRestores, { commodity_id: cid, name, seeded_rate: Number(type.rate_kg_per_ha), restore_to: null }, "commodity_id");
      saveLedger(ledger);
    }
  }

  // Allocation rule per commodity: the database's (what the app uses) when it
  // has one, otherwise the JSON's (a dry run before the migration).
  const rateOf = new Map();
  for (const c of data.commodities) {
    const id = commodityId.get(c.name);
    const row = typeof id === "number" ? await maybeOne(sb.from("commodities").select("allocation_per_hectare, max_per_farmer").eq("commodity_id", id), `rate ${c.name}`) : null;
    rateOf.set(c.name, row?.allocation_per_hectare != null ? row : { allocation_per_hectare: c.allocation_per_hectare ?? null, max_per_farmer: c.max_per_farmer ?? null });
  }
  // A farmer's total farm size: the JSON's for seeded farmers (one parcel of
  // that size), read from their parcels for existing ones.
  const seededSize = new Map(data.farmers.map((f) => [f.rsbsa_number, Number(f.farm_size_ha)]));
  const farmSizeOf = async (rsbsa, farmerId) => {
    if (seededSize.has(rsbsa)) return seededSize.get(rsbsa);
    const parcels = await must(sb.from("farm_parcels").select("farm_size_hectares").eq("farmer_id", farmerId), `farm size ${rsbsa}`);
    return Math.round(parcels.reduce((a, p) => a + (Number(p.farm_size_hectares) || 0), 0) * 100) / 100;
  };

  // ---------- Managed lists: sitios/puroks, farmers' associations, crops ----------
  // Matched by name ignoring case and spaces (as the database does). An entry
  // the test data needs that isn't on a list yet is added and recorded in
  // the ledger (cleanup removes it unless a real record uses it by then).
  const listKey = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, "");
  const listIds = { sitios: new Map(), associations: new Map(), crop_types: new Map() };
  const LIST_LEDGER = { sitios: "sitios", associations: "associations", crop_types: "cropTypes" };
  // Sitios/puroks and associations belong to a barangay (crops don't).
  async function listEntry(table, name, barangay) {
    if (!name) return null;
    const perBarangay = table !== "crop_types";
    const bid = perBarangay ? barangayId(barangay ?? "Langapod") : null;
    const k = `${bid ?? ""}|${listKey(name)}`;
    if (listIds[table].has(k)) return listIds[table].get(k);
    const rows = await must(sb.from(table).select(perBarangay ? "id, name, barangay_id" : "id, name"), table);
    const hit = rows.find((r) => listKey(r.name) === listKey(name) && (!perBarangay || r.barangay_id === bid));
    if (hit) {
      listIds[table].set(k, hit.id);
      return hit.id;
    }
    if (DRY) {
      log(`${table}: would add "${name}"`);
      listIds[table].set(k, null);
      return null;
    }
    const row = await must(sb.from(table).insert({ name, ...(perBarangay ? { barangay_id: bid } : {}) }).select("id, name").single(), `add ${table} ${name}`);
    remember(ledger[LIST_LEDGER[table]], { id: row.id, name: row.name }, "id");
    bump(table);
    saveLedger(ledger);
    listIds[table].set(k, row.id);
    return row.id;
  }
  // Test records written before Langapud's official name (Langapod): the
  // seeded associations, distribution venues and posts say Langapod now
  // (records of this seed only).
  if (!DRY) {
    const fix = (v) => (typeof v === "string" && v.includes("Langapud") ? v.replaceAll("Langapud", "Langapod") : null);
    for (const a of ledger.associations) {
      const row = await maybeOne(sb.from("associations").select("id, name").eq("id", a.id), "association name");
      if (row && fix(row.name)) { await must(sb.from("associations").update({ name: fix(row.name) }).eq("id", row.id), "rename association"); a.name = fix(row.name); bump("associations (renamed to Langapod)"); }
    }
    for (const e of ledger.events) {
      const row = await maybeOne(sb.from("distribution_events").select("event_id, venue").eq("event_id", e.event_id), "event venue");
      if (row && fix(row.venue)) { await must(sb.from("distribution_events").update({ venue: fix(row.venue) }).eq("event_id", row.event_id), "event venue"); bump("distribution venues (Langapod)"); }
    }
    for (const x of ledger.announcements) {
      const row = await maybeOne(sb.from("announcements").select("announcement_id, venue, body").eq("announcement_id", x.announcement_id), "post venue");
      if (row && (fix(row.venue) || fix(row.body))) {
        await must(sb.from("announcements").update({ venue: fix(row.venue) ?? row.venue, body: fix(row.body) ?? row.body }).eq("announcement_id", row.announcement_id), "post venue");
        bump("posts (Langapod)");
      }
    }
    saveLedger(ledger);
  }

  for (const a of data.associations ?? []) await listEntry("associations", a.name, a.barangay);

  // ---------- Farmers + addresses + parcels + crops + login accounts ----------
  for (const f of data.farmers) {
    const loginId = loginIdFromRsbsa(f.rsbsa_number);
    if (loginId !== f.login_id) throw new Error(`${f.rsbsa_number}: login_id ${f.login_id} does not match the RSBSA number (${loginId}).`);
    let row = await maybeOne(sb.from("farmers").select("farmer_id, profile_id, first_name, surname").eq("rsbsa_no", f.rsbsa_number).is("deleted_at", null), `farmer ${f.rsbsa_number}`);
    if (row && !ledger.farmers.some((x) => x.farmer_id === row.farmer_id)) {
      throw new StopError(`RSBSA ${f.rsbsa_number} already belongs to a real farmer (${row.first_name} ${row.surname}). Not touching it.`);
    }
    const clash = await must(sb.from("farmers").select("farmer_id, rsbsa_no, first_name, surname").like("rsbsa_digits", `%${loginId}`).is("deleted_at", null).neq("rsbsa_no", f.rsbsa_number), `login ID check ${loginId}`);
    if (clash.length) throw new StopError(`Login ID ${loginId} is already used by ${clash[0].first_name} ${clash[0].surname} (${clash[0].rsbsa_no}).`);

    if (!row) {
      if (DRY) { farmerByRsbsa.set(f.rsbsa_number, { id: `(new ${loginId})`, name: `${f.first_name} ${f.last_name}`, loginId, dry: true }); process.stdout.write(`  farmer ${loginId} would be created`); continue; }
      row = await must(sb.from("farmers").insert({
        rsbsa_no: f.rsbsa_number, surname: f.last_name, first_name: f.first_name, middle_name: f.middle_name || null,
        sex: f.sex.toLowerCase(), birth_date: f.birth_date, contact_no: f.contact_number, status: lower(f.status),
        association_id: await listEntry("associations", f.farmers_association, f.barangay),
      }).select("farmer_id, profile_id").single(), `insert farmer ${f.rsbsa_number}`);
      remember(ledger.farmers, { farmer_id: row.farmer_id, rsbsa_no: f.rsbsa_number }, "farmer_id");
      bump("farmers");
      saveLedger(ledger);
    }

    // Children, created the way web createFarmer() does (and re-checked on
    // every run in case an earlier run stopped partway).
    if (!DRY) {
      const addr = await must(sb.from("addresses").select("address_id").eq("farmer_id", row.farmer_id), "addresses");
      if (!addr.length) {
        const a = await must(sb.from("addresses").insert({ farmer_id: row.farmer_id, street: f.sitio_purok || null, sitio_id: await listEntry("sitios", f.sitio_purok, f.barangay), barangay: f.barangay, barangay_id: barangayId(f.barangay), municipality: f.municipality, province: f.province }).select("address_id").single(), "insert address");
        remember(ledger.addresses, a.address_id); bump("addresses");
      }
      let parcel = await maybeOne(sb.from("farm_parcels").select("parcel_id").eq("farmer_id", row.farmer_id), "farm parcel");
      if (!parcel) {
        parcel = await must(sb.from("farm_parcels").insert({ farmer_id: row.farmer_id, farm_location: f.farm_location, sitio_id: await listEntry("sitios", f.farm_location, f.barangay), farm_size_hectares: f.farm_size_ha, ownership_type: f.ownership || null, is_pcic_insured: f.pcic_insured }).select("parcel_id").single(), "insert parcel");
        remember(ledger.farmParcels, parcel.parcel_id); bump("farm_parcels");
      }
      const crop = await must(sb.from("crops").select("crop_id").eq("parcel_id", parcel.parcel_id), "crops");
      if (!crop.length) {
        const c = await must(sb.from("crops").insert({ parcel_id: parcel.parcel_id, crop_type: f.commodity, crop_type_id: await listEntry("crop_types", f.commodity), area_planted: f.farm_size_ha }).select("crop_id").single(), "insert crop");
        remember(ledger.crops, c.crop_id); bump("crops");
      }
    }

    // Login account, same as manage-farmer-account "create".
    let profileId = row.profile_id;
    const email = `${loginId}@${EMAIL_DOMAIN}`;
    if (!profileId && !DRY) {
      let user = userByEmail.get(email);
      if (user && user.app_metadata?.seed_batch !== BATCH) throw new StopError(`Login ${email} already exists and was not created by this seed.`);
      if (!user) {
        const { data: created, error } = await sb.auth.admin.createUser({
          email, password: f.password, email_confirm: true,
          user_metadata: { full_name: `${f.first_name} ${f.last_name}`, contact_no: f.contact_number ?? null },
          app_metadata: { seed_batch: BATCH },
        });
        if (error) throw new Error(`create login ${email}: ${error.message}`);
        user = created.user;
        bump("auth.users (farmers)");
        bump("profiles");
      }
      remember(ledger.authUsers, { id: user.id, email }, "id");
      saveLedger(ledger);
      await must(sb.from("farmers").update({ profile_id: user.id }).eq("farmer_id", row.farmer_id), `link login ${email}`);
      profileId = user.id;
    } else if (profileId) {
      remember(ledger.authUsers, { id: profileId, email }, "id");
    }
    farmerByRsbsa.set(f.rsbsa_number, { id: row.farmer_id, profileId, name: `${f.first_name} ${f.last_name}`, loginId });
    process.stdout.write(`  farmer ${loginId} ok`);
  }
  if (!DRY) saveLedger(ledger);
  log(`Seeded farmers: ${data.farmers.length} (${inserted.farmers ?? 0} new${DRY ? `, ${[...farmerByRsbsa.values()].filter((x) => x.dry).length} would be created` : ""})`);

  // ---------- Seeded farmers: Seed program, and no default-password reminder ----------
  // Only seeded farmers (never Maui, Claude or Luna). A Seed program already
  // set in the app is left as it is.
  for (const f of data.farmers) {
    const fr = farmerByRsbsa.get(f.rsbsa_number);
    const programId = f.seed_program ? commodityId.get(f.seed_program) : null;
    if (f.seed_program && programId == null) throw new Error(`Unknown seed program ${f.seed_program}`);
    if (DRY || fr.dry) { if (DRY && f.seed_program) log(`Farmer ${f.login_id}: Seed program ${f.seed_program}`); continue; }
    if (!ledger.farmers.some((x) => x.farmer_id === fr.id)) throw new StopError(`${f.rsbsa_number} is not a seeded farmer. Not changing it.`);
    if (typeof programId === "number") {
      const cur = await must(sb.from("farmers").select("seed_program_id").eq("farmer_id", fr.id).single(), `seed program of ${f.login_id}`);
      if (cur.seed_program_id == null) {
        await must(sb.from("farmers").update({ seed_program_id: programId }).eq("farmer_id", fr.id), `set seed program ${f.login_id}`);
        bump("farmers (Seed program set)");
      }
    }
    if (fr.profileId) {
      const off = await must(sb.from("profiles").update({ must_change_password: false }).eq("id", fr.profileId).eq("must_change_password", true).select("id"), `reminder off ${f.login_id}`);
      if (off.length) bump("profiles (password reminder off)");
    }
    // Sitio/purok, farm location, crop and farmers' association from the
    // lists (seeded farmers only; a value already linked is left as it is).
    const sitioId = await listEntry("sitios", f.sitio_purok, f.barangay);
    const farmSitioId = await listEntry("sitios", f.farm_location, f.barangay);
    const cropTypeId = await listEntry("crop_types", f.commodity);
    const associationId = await listEntry("associations", f.farmers_association, f.barangay);
    const linked = await must(sb.from("addresses").update({ sitio_id: sitioId }).eq("farmer_id", fr.id).is("sitio_id", null).select("address_id"), `sitio of ${f.login_id}`);
    if (linked.length) bump("addresses (sitio/purok linked)");
    const parcels = await must(sb.from("farm_parcels").select("parcel_id, sitio_id").eq("farmer_id", fr.id), `parcels of ${f.login_id}`);
    for (const pc of parcels) {
      if (pc.sitio_id == null && farmSitioId) {
        await must(sb.from("farm_parcels").update({ sitio_id: farmSitioId }).eq("parcel_id", pc.parcel_id), `farm location of ${f.login_id}`);
        bump("farm_parcels (farm location linked)");
      }
      const crops = await must(sb.from("crops").update({ crop_type_id: cropTypeId }).eq("parcel_id", pc.parcel_id).is("crop_type_id", null).select("crop_id"), `crop of ${f.login_id}`);
      if (crops.length) bump("crops (crop linked)");
    }
    if (associationId) {
      const joined = await must(sb.from("farmers").update({ association_id: associationId }).eq("farmer_id", fr.id).is("association_id", null).select("farmer_id"), `association of ${f.login_id}`);
      if (joined.length) bump("farmers (association set)");
    }
  }

  // ---------- Profile pictures (seeded farmers only; never overwrite) ----------
  const avatarReport = { uploaded: [], kept: [], none: [] };
  for (const f of data.farmers) {
    const fr = farmerByRsbsa.get(f.rsbsa_number);
    const name = `${f.first_name} ${f.last_name}`;
    if (NO_AVATAR.has(f.login_id)) { avatarReport.none.push(`${name} (${f.login_id})`); continue; }
    if (DRY || !fr.profileId) { avatarReport.uploaded.push(name); continue; }
    const prof = await must(sb.from("profiles").select("avatar_url").eq("id", fr.profileId).single(), "profile avatar");
    if (prof.avatar_url) { avatarReport.kept.push(name); continue; }
    const { buf, source } = await renderAvatar(f);
    const objPath = `${fr.profileId}/avatar.jpg`; // same path as mobile api/profile.js
    const { error: upErr } = await sb.storage.from("avatars").upload(objPath, buf, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`upload avatar ${name}: ${upErr.message}`);
    remember(ledger.storage, { bucket: "avatars", path: objPath }, "path");
    saveLedger(ledger);
    const { data: signed, error: signErr } = await sb.storage.from("avatars").createSignedUrl(objPath, AVATAR_TTL_SECONDS);
    if (signErr) throw new Error(`sign avatar ${name}: ${signErr.message}`);
    await must(sb.from("profiles").update({ avatar_url: signed.signedUrl }).eq("id", fr.profileId), `set avatar_url ${name}`);
    avatarReport.uploaded.push(`${name}${source === "dicebear" ? "" : ` [${source}]`}`);
    bump("storage avatars");
  }
  log(`Avatars: ${DRY ? "would upload" : "uploaded"} ${DRY ? avatarReport.uploaded.length : inserted["storage avatars"] ?? 0}, already had one ${avatarReport.kept.length}, left without ${avatarReport.none.length}`);

  // ---------- Distributions + items + tagged beneficiaries ----------
  const eventByKey = new Map();
  for (const d of data.distributions) {
    const cid = commodityId.get(d.commodity);
    if (cid == null) throw new Error(`Unknown commodity ${d.commodity}`);
    const prog = d.program_name.replace(/[%_\\]/g, "\\$&");
    let ev = await maybeOne(sb.from("distribution_events").select("event_id").eq("event_date", d.date).eq("is_deleted", false).ilike("program_name", prog), `event ${d.program_name}`);
    if (ev && !ledger.events.some((x) => x.event_id === ev.event_id)) {
      // The 20261123 migration split a seeded distribution that mixed rice
      // varieties: the new one holds only seeded rows, so it is test data too.
      const evClaims = await must(sb.from("distribution_claims").select("claim_id").eq("event_id", ev.event_id), `claims of event ${ev.event_id}`);
      if (!DRY && evClaims.length && evClaims.every((c) => ledger.claims.includes(c.claim_id))) {
        remember(ledger.events, { event_id: ev.event_id, program_name: d.program_name, event_date: d.date }, "event_id");
        const evItems = await must(sb.from("distribution_event_items").select("event_item_id").eq("event_id", ev.event_id), `items of event ${ev.event_id}`);
        evItems.forEach((i) => remember(ledger.eventItems, i.event_item_id));
        saveLedger(ledger);
        log(`Distribution adopted (split from a seeded one by the one-rate migration): ${d.program_name}`);
      } else if (!DRY || !evClaims.every((c) => ledger.claims.includes(c.claim_id))) {
        throw new StopError(`A real distribution "${d.program_name}" on ${d.date} already exists (event ${ev.event_id}). Not adding beneficiaries to it.`);
      }
    }
    // Two statuses: ongoing, or completed (items released and beneficiaries
    // signed; every tagged farmer is then Acknowledged on completed_at).
    const status = d.status.toLowerCase();
    if (!["ongoing", "completed"].includes(status)) throw new Error(`Unknown distribution status "${d.status}"`);
    const createdAt = cap(plusDays(at(d.date, "09:00"), -7, "09:00"));
    const completed = status === "completed";
    const tagTime = completed ? at(d.date, "10:00") : createdAt;
    // Marked Completed on the afternoon of the distribution (the database
    // would otherwise stamp the time of the insert).
    const completedAt = completed ? cap(at(d.date, "16:00")) : null;
    // "allocation": "farm_size" — each quantity is farm size × the
    // commodity's kg/ha rate (saved on the row); a number in the JSON instead
    // is an adjusted quantity and needs its adjustment_reason (as the app
    // requires). The total must fit the barangay allocation.
    let plan = null;
    if (d.allocation === "farm_size") {
      const rate = rateOf.get(d.commodity);
      plan = new Map();
      for (const b of d.beneficiaries) {
        const size = await farmSizeOf(b.rsbsa_number, farmerByRsbsa.get(b.rsbsa_number).id);
        const computed = allocationFor(rate, size);
        if (computed == null) throw new Error(`${d.commodity} has no allocation per hectare, so "${d.program_name}" can't be computed.`);
        const qty = typeof b.quantity_received === "number" ? b.quantity_received : computed;
        const adjusted = qty !== computed;
        if (adjusted && !b.adjustment_reason) throw new Error(`${b.name}: an adjusted quantity needs an adjustment_reason.`);
        plan.set(b.rsbsa_number, { qty, size, adjusted, reason: adjusted ? b.adjustment_reason : null, rate: Number(rate.allocation_per_hectare) });
      }
      const total = [...plan.values()].reduce((a, p) => a + p.qty, 0);
      if (d.allocation_kg && total > d.allocation_kg) throw new Error(`"${d.program_name}": ${total} kg is more than the ${d.allocation_kg} kg barangay allocation.`);
    } else if (d.allocation) {
      throw new Error(`Unknown allocation "${d.allocation}" for "${d.program_name}"`);
    }
    const totalQuantity = plan ? Math.round([...plan.values()].reduce((a, p) => a + p.qty, 0) * 100) / 100 : d.total_quantity;
    if (DRY) {
      const how = plan ? ` — by farm size: ${[...plan.values()].map((p) => `${p.size} ha → ${p.qty}${p.adjusted ? " (adjusted)" : ""}`).join(", ")} = ${totalQuantity}` : "";
      log(`Distribution: ${ev ? "exists" : "would insert"} ${d.program_name} ${d.date} (${d.status}) with ${d.beneficiaries.length} beneficiaries${how}`);
      continue;
    }
    if (!ev) {
      ev = await must(sb.from("distribution_events").insert({
        program_name: d.program_name, event_date: d.date, venue: d.venue, barangay: d.barangay, funding_source: d.funding_source,
        status, completed_at: completedAt, beneficiaries_count: d.beneficiaries.length, created_at: createdAt,
        ...(d.allocation_kg ? { allocation_kg: d.allocation_kg } : {}),
      }).select("event_id").single(), `insert event ${d.program_name}`);
      remember(ledger.events, { event_id: ev.event_id, program_name: d.program_name, event_date: d.date }, "event_id");
      bump("distribution_events");
      saveLedger(ledger);
    }
    eventByKey.set(`${d.program_name} · ${d.date}`, ev.event_id);

    let item = await maybeOne(sb.from("distribution_event_items").select("event_item_id").eq("event_id", ev.event_id).eq("commodity_id", cid), "event item");
    if (!item) {
      item = await must(sb.from("distribution_event_items").insert({ event_id: ev.event_id, commodity_id: cid, quantity_allocated: totalQuantity }).select("event_item_id").single(), "insert event item");
      remember(ledger.eventItems, item.event_item_id); bump("distribution_event_items");
    }

    const have = new Set((await must(sb.from("distribution_claims").select("farmer_id").eq("event_id", ev.event_id).eq("commodity_id", cid), "claims")).map((c) => c.farmer_id));
    const rows = d.beneficiaries.filter((b) => !have.has(farmerByRsbsa.get(b.rsbsa_number).id)).map((b) => {
      const p = plan?.get(b.rsbsa_number);
      return {
        event_id: ev.event_id, commodity_id: cid, farmer_id: farmerByRsbsa.get(b.rsbsa_number).id,
        quantity_received: p ? p.qty : b.quantity_received, claimed_at: cap(tagTime),
        ...(p ? { farm_size_hectares: p.size, quantity_adjusted: p.adjusted, adjustment_reason: p.reason, rate_kg_per_ha: p.rate } : {}),
      };
    });
    if (rows.length) {
      const claims = await must(sb.from("distribution_claims").insert(rows).select("claim_id"), `tag beneficiaries ${d.program_name}`);
      claims.forEach((c) => remember(ledger.claims, c.claim_id));
      bump("distribution_claims", claims.length);
      saveLedger(ledger);
      await captureNotifs(completed ? at(d.date, "16:00") : createdAt, ["You received a distribution", "You're listed in an upcoming distribution"]);
    }
  }
  if (!DRY) saveLedger(ledger);

  // ---------- Proof of planting submissions ----------
  for (const s of data.proof_of_planting_submissions) {
    const fr = farmerByRsbsa.get(s.rsbsa_number);
    if (!fr) throw new Error(`Submission for unknown farmer ${s.rsbsa_number}`);
    const submitted = new Date(s.submitted_at).toISOString();
    if (DRY || fr.dry) { if (DRY) log(`Submission: would insert ${s.farmer} (${s.status})`); continue; }
    const existing = await maybeOne(sb.from("crop_validations").select("validation_id").eq("farmer_id", fr.id).eq("captured_at", submitted), `submission ${s.farmer}`);
    if (existing) {
      if (!ledger.cropValidations.some((x) => x.validation_id === existing.validation_id)) notes.push(`A real submission by ${s.farmer} at ${s.submitted_at} already exists; skipped.`);
      continue;
    }
    // Links to the farmer's own matching crop (referenced, never changed).
    const [crop] = await must(sb.from("crops").select("crop_id, farm_parcels!inner ( farmer_id )").eq("farm_parcels.farmer_id", fr.id).ilike("crop_type", s.crop_type).order("crop_id").limit(1), `crop for ${s.farmer}`);
    const photoPath = `${fr.id}/${BATCH}-${loginIdFromRsbsa(s.rsbsa_number)}.jpg`;
    const { error: upErr } = await sb.storage.from("crop-validation-photos").upload(photoPath, await renderPlaceholderPhoto(s), { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`upload placeholder photo ${s.farmer}: ${upErr.message}`);
    remember(ledger.storage, { bucket: "crop-validation-photos", path: photoPath }, "path");
    bump("storage placeholder photos");

    const v = await must(sb.from("crop_validations").insert({
      farmer_id: fr.id, crop_id: crop?.crop_id ?? null, photo_url: photoPath, latitude: s.latitude, longitude: s.longitude,
      gps_accuracy_meters: GPS_ACCURACY_M, captured_at: submitted, created_at: submitted, status: "pending",
    }).select("validation_id").single(), `insert submission ${s.farmer}`);
    remember(ledger.cropValidations, { validation_id: v.validation_id, farmer_id: fr.id }, "validation_id");
    bump("crop_validations");
    saveLedger(ledger);
    await captureNotifs(submitted, ["New crop validation submitted"]);

    const status = s.status.toLowerCase();
    if (status !== "pending") {
      const reviewedAt = cap(new Date(new Date(submitted).getTime() + 86_400_000).toISOString());
      await must(sb.from("crop_validations").update({ status, remarks: s.remarks || null, reviewed_by: maoId, reviewed_at: reviewedAt }).eq("validation_id", v.validation_id), `review submission ${s.farmer}`);
      await captureNotifs(reviewedAt, ["Your crop validation was approved", "Your crop validation was rejected"]);
    }
  }

  // ---------- Commodity requests (straight to the MAO) ----------
  // Inserted Pending the way the app does (notifies the MAO Admin and the
  // FA President); "Recommended" adds the FA President's recommendation
  // (notifies the MAO); Approved / Rejected are then decided by the MAO
  // Admin (notifies the farmer). Existing farmers are only referenced.
  const REQUEST_STATUS = { Pending: "pending", Recommended: "pending", Approved: "approved", Rejected: "rejected" };
  async function suggestedQty(r, fr) {
    const qty = allocationFor(rateOf.get(r.commodity), await farmSizeOf(r.rsbsa_number, fr.id));
    if (!(qty > 0)) throw new Error(`${r.farmer}: no suggested quantity for ${r.commodity} (no rate or farm size).`);
    return qty;
  }
  async function recommend(requestId, remarks, when) {
    await must(sb.from("requests").update({
      fa_recommended: true, fa_recommended_at: when, fa_remarks: remarks || null, reviewed_by_fa: faId,
    }).eq("request_id", requestId), "recommend request");
    await captureNotifs(when, ["Request recommended"]);
  }
  async function decide(requestId, status, remarks, when) {
    await must(sb.from("requests").update({
      status, mao_remarks: remarks || null, reviewed_by_mao: maoId, admin_decision_at: when,
    }).eq("request_id", requestId), "decide request");
    await captureNotifs(when, ["Your request was approved", "Your request was rejected"]);
  }

  for (const r of data.commodity_requests) {
    const fr = farmerByRsbsa.get(r.rsbsa_number);
    const cid = commodityId.get(r.commodity);
    const status = REQUEST_STATUS[r.status];
    if (!status) throw new Error(`Unknown request status "${r.status}"`);
    const created = new Date(at(r.request_date, "08:30")).toISOString();
    if (DRY || fr.dry || typeof cid !== "number") { if (DRY) log(`Request: would insert ${r.farmer} → ${r.commodity} (${r.status})`); continue; }
    const existing = await maybeOne(sb.from("requests").select("request_id").eq("farmer_id", fr.id).eq("commodity_id", cid).eq("created_at", created), `request ${r.farmer}`);
    if (existing) continue;
    const qty = r.quantity === "suggested" ? await suggestedQty(r, fr) : r.quantity;
    const req = await must(sb.from("requests").insert({
      farmer_id: fr.id, commodity_id: cid, quantity_requested: qty, reason: r.reason ?? DEFAULT_REASON, status: "pending", created_at: created,
    }).select("request_id").single(), `insert request ${r.farmer}`);
    remember(ledger.requests, req.request_id);
    bump("requests");
    saveLedger(ledger);
    await captureNotifs(created, ["New commodity request"]);
    if (r.status === "Recommended" || r.fa_remarks) await recommend(req.request_id, r.fa_remarks ?? FA_FORWARD_REMARK, cap(plusDays(created, 1, "10:00")));
    if (status === "pending") continue;
    await decide(req.request_id, status, r.remarks, cap(plusDays(created, 2, "14:00")));
  }

  // ---------- Requests the FA President filed for farmers ----------
  // Saved the way the app files them: Pending, filed_by the FA President
  // (notifies the MAO Admin and the farmer); some also recommended;
  // Approved / Rejected ones are then decided by the MAO Admin.
  for (const r of data.farmer_requests_filed_by_fa ?? []) {
    const fr = farmerByRsbsa.get(r.rsbsa_number);
    const cid = commodityId.get(r.commodity);
    const status = REQUEST_STATUS[r.status];
    if (!fr) throw new Error(`Filed request for unknown farmer ${r.rsbsa_number}`);
    if (!status || r.status === "Recommended") throw new Error(`Unknown filed-request status "${r.status}"`);
    const created = new Date(at(r.request_date, "09:30")).toISOString();
    if (DRY || fr.dry || typeof cid !== "number" || !faId) { if (DRY) log(`Filed request: would insert ${r.farmer} → ${r.commodity} (${r.status}${r.recommended ? ", recommended" : ""}, filed by the FA President)`); continue; }
    const existing = await maybeOne(sb.from("requests").select("request_id").eq("farmer_id", fr.id).eq("commodity_id", cid).eq("created_at", created), `filed request ${r.farmer}`);
    if (existing) continue;
    const qty = r.quantity === "suggested" ? await suggestedQty(r, fr) : r.quantity;
    const req = await must(sb.from("requests").insert({
      farmer_id: fr.id, commodity_id: cid, quantity_requested: qty, reason: r.reason, status: "pending", created_at: created, filed_by: faId,
    }).select("request_id").single(), `insert filed request ${r.farmer}`);
    remember(ledger.requests, req.request_id);
    bump("requests (filed by the FA President)");
    saveLedger(ledger);
    await captureNotifs(created, ["New commodity request", "A request was filed for you"]);
    if (r.recommended) await recommend(req.request_id, r.fa_remarks ?? FA_FORWARD_REMARK, cap(plusDays(created, 0, "09:45")));
    if (status === "pending") continue;
    await decide(req.request_id, status, r.remarks, cap(plusDays(created, 1, "14:00")));
  }

  // ---------- Harvest reports (kg) ----------
  // Inserted Submitted the way the apps file them (a farmer's own report
  // notifies the MAO Admin and the FA President; one the FA President filed
  // notifies the MAO Admin and the farmer), then Verified or Returned by the
  // MAO Admin (notifies the farmer). Maui, Claude and Luna only get new
  // report rows that reference them. Matched on farmer + harvest date. No
  // Wet/Dry season (retired Nov 24, 2026): the season columns are left empty.
  const HARVEST_STATUS = { Submitted: "submitted", Verified: "verified", Returned: "returned" };
  for (const hr of data.harvest_reports ?? []) {
    const fr = farmerByRsbsa.get(hr.rsbsa_number);
    const cid = commodityId.get(hr.commodity);
    const status = HARVEST_STATUS[hr.status];
    if (!fr) throw new Error(`Harvest report for unknown farmer ${hr.rsbsa_number}`);
    if (!status) throw new Error(`Harvest report for ${hr.farmer}: unknown status`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hr.harvest_date ?? "")) throw new Error(`Harvest report for ${hr.farmer}: harvest_date is required (YYYY-MM-DD).`);
    if (status === "returned" && !hr.review_remarks) throw new Error(`Harvest report for ${hr.farmer}: Returned needs review_remarks.`);
    if (DRY || fr.dry || typeof cid !== "number") { if (DRY) log(`Harvest report: would insert ${hr.farmer} harvested ${hr.harvest_date} · ${hr.commodity} · ${hr.area_ha} ha · ${hr.yield_kg} kg (${hr.status}${hr.filed_by ? ", filed by the FA President" : ""})`); continue; }
    const existing = await maybeOne(sb.from("harvest_reports").select("harvest_report_id").eq("farmer_id", fr.id).eq("harvest_date", hr.harvest_date).is("deleted_at", null), `harvest report ${hr.farmer}`);
    if (existing) {
      if (!ledger.harvestReports.some((x) => x.harvest_report_id === existing.harvest_report_id)) notes.push(`A real harvest report by ${hr.farmer} harvested ${hr.harvest_date} already exists; skipped.`);
      continue;
    }
    const filedByFa = hr.filed_by === "fa_president";
    if (filedByFa && !faId) continue;
    const submittedBy = filedByFa ? faId : fr.profileId;
    if (!submittedBy) throw new Error(`Harvest report for ${hr.farmer}: the farmer has no account; file it as the FA President.`);
    const created = cap(plusDays(at(hr.harvest_date, "09:00"), 1, "09:00"));
    let photoPath = null;
    if (hr.photo) {
      photoPath = `${fr.id}/${BATCH}-harvest-${loginIdFromRsbsa(hr.rsbsa_number)}-${hr.harvest_date}.jpg`;
      const { error: upErr } = await sb.storage.from("harvest-photos").upload(photoPath, await renderHarvestPhoto(hr), { contentType: "image/jpeg", upsert: true });
      if (upErr) throw new Error(`upload harvest photo ${hr.farmer}: ${upErr.message}`);
      remember(ledger.storage, { bucket: "harvest-photos", path: photoPath }, "path");
      bump("storage harvest photos");
      saveLedger(ledger);
    }
    const row = await must(sb.from("harvest_reports").insert({
      farmer_id: fr.id, commodity_id: cid,
      area_harvested_ha: hr.area_ha, yield_kg: hr.yield_kg, harvest_date: hr.harvest_date, remarks: hr.remarks || null,
      photo_path: photoPath, latitude: hr.latitude ?? null, longitude: hr.longitude ?? null,
      gps_accuracy_meters: hr.latitude != null ? GPS_ACCURACY_M : null, photo_captured_at: photoPath ? cap(at(hr.harvest_date, "15:00")) : null,
      status: "submitted", submitted_by: submittedBy, created_at: created, updated_at: created,
    }).select("harvest_report_id").single(), `insert harvest report ${hr.farmer}`);
    remember(ledger.harvestReports, { harvest_report_id: row.harvest_report_id, farmer: hr.farmer }, "harvest_report_id");
    bump("harvest_reports");
    saveLedger(ledger);
    await captureNotifs(created, ["New harvest report", "A harvest was reported for you"]);
    if (status === "submitted") continue;
    const reviewedAt = cap(plusDays(created, 2, "10:00"));
    await must(sb.from("harvest_reports").update({
      status, review_remarks: hr.review_remarks || null, reviewed_by: maoId, reviewed_at: reviewedAt, updated_at: reviewedAt,
    }).eq("harvest_report_id", row.harvest_report_id), `review harvest report ${hr.farmer}`);
    await captureNotifs(reviewedAt, ["Harvest report verified", "Harvest report returned"]);
  }

  // ---------- Announcements ----------
  // A post: title, optional date / time / venue, details, and who can see
  // it (audience, barangays). An earlier run's post is recognized by its
  // title.
  for (const a of data.announcements) {
    const first = a.title;
    const existing = await maybeOne(sb.from("announcements").select("announcement_id").eq("title", first), `announcement ${first}`);
    if (existing) {
      if (!ledger.announcements.some((x) => x.announcement_id === existing.announcement_id)) notes.push(`A real announcement "${first}" already exists; skipped.`);
      continue;
    }
    if (DRY) { log(`Announcement: would post "${first}" (${a.status}, ${a.audience}, ${a.barangays?.join(", ") ?? "all barangays"})`); continue; }
    const postedAt = cap(ANNOUNCEMENT_AT[first] ?? new Date(NOW).toISOString());
    const published = a.status === "Published";
    // "photo": true — a sample photo (marked as test data) in the post.
    let imagePath = null;
    if (a.photo) {
      imagePath = `test/${first.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.jpg`;
      const jpg = await renderPlaceholderPhoto({}, { title: "SAMPLE ANNOUNCEMENT PHOTO · TEST DATA", caption: `${first} · ${a.barangays?.join(", ") ?? "All barangays"}` });
      const { error: upErr } = await sb.storage.from("announcement-images").upload(imagePath, jpg, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw new Error(`upload announcement photo ${first}: ${upErr.message}`);
      remember(ledger.storage, { bucket: "announcement-images", path: imagePath }, "path");
      saveLedger(ledger);
      bump("storage announcement photos");
    }
    const ann = await must(sb.from("announcements").insert({
      title: a.title, body: a.details ?? "", distribution_date: a.date ?? null, distribution_time: a.time ?? null, venue: a.venue ?? null,
      audience: a.audience, all_barangays: !a.barangays, barangay_ids: (a.barangays ?? []).map(barangayId),
      is_pinned: !!a.pinned, status: published ? "published" : "draft", image_url: imagePath,
      created_by: maoId, created_at: postedAt,
    }).select("announcement_id").single(), `insert announcement ${first}`);
    remember(ledger.announcements, { announcement_id: ann.announcement_id, title: first }, "announcement_id");
    bump("announcements");
    saveLedger(ledger);
    if (published) {
      await must(sb.from("announcements").update({ published_at: postedAt }).eq("announcement_id", ann.announcement_id), "backdate published_at");
      await captureNotifs(postedAt, ["MAO Labangan posted an announcement"]);
    }
  }

  // ---------- Audit entries the triggers wrote for this run ----------
  if (!DRY) {
    const idsFor = {
      farmers: ledger.farmers.map((x) => x.farmer_id), commodities: ledger.commodities.map((x) => x.commodity_id),
      distribution_events: ledger.events.map((x) => x.event_id), distribution_event_items: ledger.eventItems,
      distribution_claims: ledger.claims, crop_validations: ledger.cropValidations.map((x) => x.validation_id),
      requests: ledger.requests, announcements: ledger.announcements.map((x) => x.announcement_id),
      association_requests: ledger.associationRequests.map((x) => x.association_request_id),
      harvest_reports: ledger.harvestReports.map((x) => x.harvest_report_id),
      commodity_types: ledger.commodityTypes.map((x) => x.commodity_type_id),
      sitios: ledger.sitios.map((x) => x.id),
      associations: ledger.associations.map((x) => x.id),
      crop_types: ledger.cropTypes.map((x) => x.id),
    };
    for (const [table, pk] of Object.entries(AUDITED)) {
      for (const ids of chunk(idsFor[table].map(String))) {
        if (!ids.length) continue;
        const rows = await must(sb.from("audit_logs").select("log_id").eq("table_name", table).gt("log_id", auditMark).is("actor_id", null).in(`details->>${pk}`, ids), `audit ${table}`);
        rows.forEach((r) => remember(ledger.auditLogs, r.log_id));
        if (rows.length) bump("audit_logs (by triggers)", rows.length);
      }
    }
    saveLedger(ledger);
  }

  // ---------- Report ----------
  log(`\n${DRY ? "Would insert" : "Inserted this run"}:`);
  const keys = Object.keys(inserted);
  if (!keys.length && !DRY) log("  nothing (everything already seeded)");
  for (const k of keys) log(`  ${k.padEnd(28)} ${inserted[k]}`);
  log(`\nAvatars ${DRY ? "to upload" : "uploaded"}: ${DRY ? avatarReport.uploaded.length : inserted["storage avatars"] ?? 0}${avatarReport.kept.length ? ` (already had one: ${avatarReport.kept.length})` : ""}`);
  log(`Left without a picture: ${avatarReport.none.join(", ")}`);
  for (const n of new Set(notes)) log(`Note: ${n}`);
  if (!DRY) log(`Ledger: ${LEDGER_FILE}`);
}

// Exit explicitly: an idle keep-alive connection must not hold the process open.
main().then(() => process.exit(0)).catch((err) => {
  if (!DRY) saveLedger(ledger);
  console.error(err instanceof StopError ? `\nSTOPPED (nothing real was changed): ${err.message}` : `\nSEED FAILED: ${err.message}`);
  process.exit(err instanceof StopError ? 2 : 1);
});

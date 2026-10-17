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

async function renderPlaceholderPhoto(s) {
  const w = 1280, h = 960, horizon = 330;
  const rows = Array.from({ length: 15 }, (_, i) => {
    const x = (i - 7) * 190;
    return `<path d="M${w / 2 + x * 0.12} ${horizon} L${w / 2 + x * 1.6 - 40} ${h} L${w / 2 + x * 1.6 + 40} ${h} Z" fill="#3f8f3a" opacity="0.55"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd0ef"/><stop offset="1" stop-color="#e6f3f8"/></linearGradient>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8cc06a"/><stop offset="1" stop-color="#4f8f37"/></linearGradient></defs>
    <rect width="${w}" height="${horizon}" fill="url(#sky)"/><circle cx="1060" cy="120" r="56" fill="#ffe08a"/>
    <path d="M0 ${horizon} Q 320 ${horizon - 60} 640 ${horizon} T 1280 ${horizon} V ${horizon + 10} H 0 Z" fill="#6d9f55"/>
    <rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#field)"/>${rows}
    <rect y="${h - 170}" width="${w}" height="170" fill="#0b1f12" opacity="0.62"/>
    <text x="40" y="${h - 110}" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="700" fill="#ffffff">SAMPLE PROOF-OF-PLANTING PHOTO · TEST DATA</text>
    <text x="40" y="${h - 58}" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#e8f2ea">${xml(`${s.farmer} · ${s.crop_type} · ${s.submitted_at.slice(0, 10)} · ${s.latitude}, ${s.longitude}`)}</text>
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

  // ---------- FA President account ----------
  const fa = data.accounts.fa_president;
  let faUser = userByEmail.get(fa.email.toLowerCase());
  if (faUser && faUser.app_metadata?.seed_batch !== BATCH) throw new StopError(`${fa.email} already exists and was not created by this seed.`);
  let faId = faUser?.id ?? null;
  if (!faUser && !DRY) {
    const { data: created, error } = await sb.auth.admin.createUser({
      email: fa.email, password: fa.password, email_confirm: true,
      user_metadata: { role: "fa_president", full_name: fa.name },
      app_metadata: { seed_batch: BATCH },
    });
    if (error) throw new Error(`create FA President: ${error.message}`);
    faId = created.user.id;
    bump("auth.users (FA President)");
    bump("profiles");
  }
  if (faId) remember(ledger.authUsers, { id: faId, email: fa.email }, "id");
  log(`FA President ${fa.name}: ${faUser ? "already seeded" : DRY ? "would create" : "created"}`);
  if (!DRY) saveLedger(ledger);

  // ---------- Commodities: reuse by name, insert only missing ----------
  const commodityId = new Map();
  for (const c of data.commodities) {
    const name = c.name.replace(/[%_\\]/g, "\\$&");
    const row = await maybeOne(sb.from("commodities").select("commodity_id, name, category, unit, status").ilike("name", name).is("deleted_at", null), `commodity ${c.name}`);
    if (row) {
      commodityId.set(c.name, row.commodity_id);
      const ours = ledger.commodities.some((x) => x.commodity_id === row.commodity_id);
      const diffs = [["category", row.category, c.category], ["unit", row.unit, c.unit], ["status", row.status, lower(c.status)]]
        .filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k} ${a} (JSON: ${b})`);
      if (!ours) log(`Commodity reused (existing, not modified): ${row.name}${diffs.length ? ` — differs: ${diffs.join(", ")}` : ""}`);
      continue;
    }
    if (DRY) { log(`Commodity: would insert ${c.name}`); commodityId.set(c.name, `(new ${c.name})`); continue; }
    const ins = await must(sb.from("commodities").insert({ name: c.name, category: c.category, unit: c.unit, status: lower(c.status) }).select("commodity_id").single(), `insert commodity ${c.name}`);
    commodityId.set(c.name, ins.commodity_id);
    remember(ledger.commodities, { commodity_id: ins.commodity_id, name: c.name }, "commodity_id");
    bump("commodities");
    log(`Commodity inserted: ${c.name}`);
  }
  if (!DRY) saveLedger(ledger);

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
        const a = await must(sb.from("addresses").insert({ farmer_id: row.farmer_id, street: f.sitio_purok || null, barangay: f.barangay, municipality: f.municipality, province: f.province }).select("address_id").single(), "insert address");
        remember(ledger.addresses, a.address_id); bump("addresses");
      }
      let parcel = await maybeOne(sb.from("farm_parcels").select("parcel_id").eq("farmer_id", row.farmer_id), "farm parcel");
      if (!parcel) {
        parcel = await must(sb.from("farm_parcels").insert({ farmer_id: row.farmer_id, farm_location: f.farm_location, farm_size_hectares: f.farm_size_ha, ownership_type: f.ownership || null, is_pcic_insured: f.pcic_insured }).select("parcel_id").single(), "insert parcel");
        remember(ledger.farmParcels, parcel.parcel_id); bump("farm_parcels");
      }
      const crop = await must(sb.from("crops").select("crop_id").eq("parcel_id", parcel.parcel_id), "crops");
      if (!crop.length) {
        const c = await must(sb.from("crops").insert({ parcel_id: parcel.parcel_id, crop_type: f.commodity, area_planted: f.farm_size_ha }).select("crop_id").single(), "insert crop");
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
          user_metadata: { role: "farmer", full_name: `${f.first_name} ${f.last_name}`, contact_no: f.contact_number ?? null },
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
      throw new StopError(`A real distribution "${d.program_name}" on ${d.date} already exists (event ${ev.event_id}). Not adding beneficiaries to it.`);
    }
    // One status: ongoing -> distributed (items released) -> completed
    // (signed acknowledgement receipts collected).
    const status = d.status.toLowerCase();
    if (!["ongoing", "distributed", "completed"].includes(status)) throw new Error(`Unknown distribution status "${d.status}"`);
    const createdAt = cap(plusDays(at(d.date, "09:00"), -7, "09:00"));
    const released = status !== "ongoing";
    const tagTime = released ? at(d.date, "10:00") : createdAt;
    // Receipts "collected" two days after the distribution (the database
    // would otherwise stamp the time of the insert).
    const receiptsAt = status === "completed" ? cap(plusDays(at(d.date, "09:00"), 2, "15:00")) : null;
    if (DRY) { log(`Distribution: ${ev ? "exists" : "would insert"} ${d.program_name} ${d.date} (${d.status}) with ${d.beneficiaries.length} beneficiaries`); continue; }
    if (!ev) {
      ev = await must(sb.from("distribution_events").insert({
        program_name: d.program_name, event_date: d.date, venue: d.venue, barangay: d.barangay, funding_source: d.funding_source,
        status, receipts_collected_at: receiptsAt, beneficiaries_count: d.beneficiaries.length, created_at: createdAt,
      }).select("event_id").single(), `insert event ${d.program_name}`);
      remember(ledger.events, { event_id: ev.event_id, program_name: d.program_name, event_date: d.date }, "event_id");
      bump("distribution_events");
      saveLedger(ledger);
    }
    eventByKey.set(`${d.program_name} · ${d.date}`, ev.event_id);

    let item = await maybeOne(sb.from("distribution_event_items").select("event_item_id").eq("event_id", ev.event_id).eq("commodity_id", cid), "event item");
    if (!item) {
      item = await must(sb.from("distribution_event_items").insert({ event_id: ev.event_id, commodity_id: cid, quantity_allocated: d.total_quantity }).select("event_item_id").single(), "insert event item");
      remember(ledger.eventItems, item.event_item_id); bump("distribution_event_items");
    }

    const have = new Set((await must(sb.from("distribution_claims").select("farmer_id").eq("event_id", ev.event_id).eq("commodity_id", cid), "claims")).map((c) => c.farmer_id));
    const rows = d.beneficiaries.filter((b) => !have.has(farmerByRsbsa.get(b.rsbsa_number).id)).map((b) => ({
      event_id: ev.event_id, commodity_id: cid, farmer_id: farmerByRsbsa.get(b.rsbsa_number).id,
      quantity_received: b.quantity_received, claimed_at: cap(tagTime),
    }));
    if (rows.length) {
      const claims = await must(sb.from("distribution_claims").insert(rows).select("claim_id"), `tag beneficiaries ${d.program_name}`);
      claims.forEach((c) => remember(ledger.claims, c.claim_id));
      bump("distribution_claims", claims.length);
      saveLedger(ledger);
      await captureNotifs(released ? at(d.date, "16:00") : createdAt, ["You received a distribution", "You're listed in an upcoming distribution"]);
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

  // ---------- Commodity requests ----------
  const REQUEST_STATUS = { "Pending FA review": "pending", "Forwarded to MAO": "forwarded", Approved: "approved", Rejected: "rejected" };
  for (const r of data.commodity_requests) {
    const fr = farmerByRsbsa.get(r.rsbsa_number);
    const cid = commodityId.get(r.commodity);
    const status = REQUEST_STATUS[r.status];
    if (!status) throw new Error(`Unknown request status "${r.status}"`);
    const created = new Date(at(r.request_date, "08:30")).toISOString();
    if (DRY || fr.dry || typeof cid !== "number") { if (DRY) log(`Request: would insert ${r.farmer} → ${r.commodity} (${status})`); continue; }
    const existing = await maybeOne(sb.from("requests").select("request_id").eq("farmer_id", fr.id).eq("commodity_id", cid).eq("created_at", created), `request ${r.farmer}`);
    if (existing) continue;
    const req = await must(sb.from("requests").insert({
      farmer_id: fr.id, commodity_id: cid, quantity_requested: r.quantity, reason: DEFAULT_REASON, status: "pending", created_at: created,
    }).select("request_id").single(), `insert request ${r.farmer}`);
    remember(ledger.requests, req.request_id);
    bump("requests");
    saveLedger(ledger);
    await captureNotifs(created, ["New commodity request"]);
    if (status === "pending") continue;

    const faAt = cap(plusDays(created, 1, "10:00"));
    await must(sb.from("requests").update({
      status: "forwarded", fa_remarks: FA_FORWARD_REMARK, reviewed_by_fa: faId, fa_decision_at: faAt, forwarded_to_admin_at: faAt,
    }).eq("request_id", req.request_id), `forward request ${r.farmer}`);
    await captureNotifs(faAt, ["Request awaiting your review"]);
    if (status === "forwarded") continue;

    const adminAt = cap(plusDays(created, 2, "14:00"));
    await must(sb.from("requests").update({
      status, mao_remarks: r.remarks || null, reviewed_by_mao: maoId, admin_decision_at: adminAt,
    }).eq("request_id", req.request_id), `decide request ${r.farmer}`);
    await captureNotifs(adminAt, ["Your request was approved", "Your request was rejected"]);
  }

  // ---------- Announcements ----------
  for (const a of data.announcements) {
    const existing = await maybeOne(sb.from("announcements").select("announcement_id").eq("title", a.title), `announcement ${a.title}`);
    if (existing) {
      if (!ledger.announcements.some((x) => x.announcement_id === existing.announcement_id)) notes.push(`A real announcement titled "${a.title}" already exists; skipped.`);
      continue;
    }
    if (DRY) { log(`Announcement: would insert "${a.title}" (${a.status})`); continue; }
    let linked = null;
    if (a.linked_distribution) {
      linked = eventByKey.get(a.linked_distribution.replace(/\s*·\s*/, " · "));
      if (!linked) throw new Error(`Linked distribution not found: ${a.linked_distribution}`);
    }
    const postedAt = cap(ANNOUNCEMENT_AT[a.title] ?? new Date(NOW).toISOString());
    const published = a.status === "Published";
    const ann = await must(sb.from("announcements").insert({
      title: a.title, body: a.details, is_pinned: !!a.pinned, status: published ? "published" : "draft",
      for_all_registered_farmers: a.recipients.includes("All Registered Farmers"),
      for_fa_president: a.recipients.includes("Farmers' Association President"),
      distribution_date: a.distribution_date ?? null, distribution_time: a.time ?? null, venue: a.venue ?? null,
      assistance_type: a.assistance_type ?? null, requirements: a.requirements ?? null, linked_distribution_id: linked,
      created_by: maoId, created_at: postedAt,
    }).select("announcement_id").single(), `insert announcement ${a.title}`);
    remember(ledger.announcements, { announcement_id: ann.announcement_id, title: a.title }, "announcement_id");
    bump("announcements");
    saveLedger(ledger);
    if (published) {
      await must(sb.from("announcements").update({ published_at: postedAt }).eq("announcement_id", ann.announcement_id), "backdate published_at");
      await captureNotifs(postedAt, [`New announcement: ${a.title}`]);
    }
  }

  // ---------- Audit entries the triggers wrote for this run ----------
  if (!DRY) {
    const idsFor = {
      farmers: ledger.farmers.map((x) => x.farmer_id), commodities: ledger.commodities.map((x) => x.commodity_id),
      distribution_events: ledger.events.map((x) => x.event_id), distribution_event_items: ledger.eventItems,
      distribution_claims: ledger.claims, crop_validations: ledger.cropValidations.map((x) => x.validation_id),
      requests: ledger.requests, announcements: ledger.announcements.map((x) => x.announcement_id),
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

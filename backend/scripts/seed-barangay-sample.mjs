// Sample farmers for every barangay.
//
//   node backend/scripts/seed-barangay-sample.mjs            # dev: fill each barangay up to 20 Active farmers
//   node backend/scripts/seed-barangay-sample.mjs --dry-run  # say what it would add, add nothing
//   node backend/scripts/seed-barangay-sample.mjs --remove   # take out everything this script added
//   add --live to any of these for the live project (only when the owner asks)
//
// For each active barangay with fewer than 20 Active farmers, adds fictional
// farmers (made-up names, valid 11-digit 09 numbers, RSBSA numbers
// 09-73-00-BBB-3NNNNN), each with a sitio/purok, a farm parcel, one or two
// types of farmer, a mobile login (last 6 digits of the RSBSA number,
// password123) and a profile picture. A barangay without sitios/puroks gets
// Purok 1–5 (added by its Farmers' Association President when it has one).
// Everything added is written to a ledger (sample-farmers.ledger.dev.json, or
// sample-farmers.ledger.json for live) so --remove takes out exactly that.
// On live, only the sample farmers get pictures; real farmers are never
// touched. Without --live it refuses to run against anything but agrishare-dev.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const DEV_REF = "peyyzxbjcugyqfdrrlyz";
const LIVE_REF = "bofvqdywhyrlbzatvxve";
const LIVE = process.argv.includes("--live");
const here = import.meta.dirname;
const envFile = path.join(here, "..", LIVE ? ".env.seed" : ".env.seed.dev");
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!String(env.SUPABASE_URL).includes(LIVE ? LIVE_REF : DEV_REF)) {
  console.error(`Stopped: ${envFile} isn't the ${LIVE ? "live" : "development"} project.`);
  process.exit(1);
}
console.log(`Target: ${LIVE ? "LIVE project" : "development database (agrishare-dev)"}`);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry-run");
const REMOVE = process.argv.includes("--remove");
const TARGET = 20;
const LEDGER = path.join(here, LIVE ? "sample-farmers.ledger.json" : "sample-farmers.ledger.dev.json");
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { farmers: [], sitios: [] };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));

async function must(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// ---------- --remove ----------
if (REMOVE) {
  const ids = ledger.farmers;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await must(sb.from("farmer_farmer_types").delete().in("farmer_id", chunk), "types");
    await must(sb.from("farm_parcels").delete().in("farmer_id", chunk), "parcels");
    await must(sb.from("addresses").delete().in("farmer_id", chunk), "addresses");
    await must(sb.from("farmers").delete().in("farmer_id", chunk), "farmers");
  }
  let sitiosGone = 0;
  for (const id of ledger.sitios) {
    const { error } = await sb.from("sitios").delete().eq("id", id);
    if (!error) sitiosGone++;
  }
  // Pictures added to other farmers: taken off again.
  for (const profileId of ledger.picturesFor ?? []) await sb.from("profiles").update({ avatar_url: null }).eq("id", profileId);
  for (let i = 0; i < (ledger.avatars ?? []).length; i += 100) await sb.storage.from("avatars").remove(ledger.avatars.slice(i, i + 100));
  let loginsGone = 0;
  for (const id of ledger.authUsers ?? []) {
    const { error } = await sb.auth.admin.deleteUser(id);
    if (!error) loginsGone++;
  }
  console.log(`Removed ${ids.length} sample farmers, ${loginsGone} logins, ${(ledger.avatars ?? []).length} pictures and ${sitiosGone} sitios/puroks.`);
  fs.writeFileSync(LEDGER, JSON.stringify({ farmers: [], sitios: [], authUsers: [], avatars: [], picturesFor: [] }, null, 1));
  process.exit(0);
}

// ---------- names, numbers, types (repeatable: same run, same farmers) ----------
let seed = 20261126;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + rand() * (b - a);

const MALE = ["Jose", "Juan", "Pedro", "Ramon", "Antonio", "Rogelio", "Ernesto", "Danilo", "Romeo", "Eduardo", "Rodrigo", "Felipe", "Alfredo", "Wilfredo", "Rolando", "Teodoro", "Arnel", "Joel", "Reynaldo", "Nestor", "Mario", "Ricardo", "Leonardo", "Virgilio", "Domingo", "Crisanto", "Junrey", "Jomar", "Rey", "Jerome"];
const FEMALE = ["Maria", "Rosario", "Teresita", "Luzviminda", "Erlinda", "Nenita", "Corazon", "Gloria", "Leticia", "Remedios", "Josefina", "Marites", "Analyn", "Lorna", "Rosalie", "Evangeline", "Gemma", "Aida", "Cristina", "Mila", "Jocelyn", "Marilou", "Rowena", "Lilibeth", "Merlyn", "Jessa", "Charlyn", "Divina", "Imelda", "Norma"];
const SURNAMES = ["Abellana", "Alcantara", "Bacalso", "Bagaipo", "Balili", "Baguio", "Cabahug", "Cabiling", "Caburnay", "Dacalos", "Dumdum", "Enriquez", "Gumanoy", "Inting", "Lagunay", "Lumapas", "Lumbay", "Maglasang", "Ompad", "Pacatang", "Paglinawan", "Pasilan", "Pepito", "Ranoco", "Sumalpong", "Sumampong", "Tumulak", "Ybañez", "Villamor", "Yap", "Saavedra", "Catubig", "Labadan", "Ondoy", "Pagaran", "Sabanal", "Tabanao", "Cuyos", "Omay", "Bacus"];
const MIDDLE = ["Arcay", "Bontia", "Calibo", "Dela Cruz", "Estrada", "Ferrer", "Gallardo", "Hinayon", "Ibarra", "Jumawan", "Lim", "Manlangit", "Navarro", "Ocampo", "Plaza", "Quiñones", "Rosales", "Sarmiento", "Tagalog", "Uy"];
const OWNERSHIP = ["Owner", "Owner", "Owner", "Tenant", "Tenant", "Lessee", "Farmworker"];
// Weighted like a Mindanao lowland municipality: mostly rice and corn.
const TYPE_WEIGHTS = [
  ["Rice farmer", 34], ["Corn farmer", 22], ["Coconut farmer", 14], ["Vegetable farmer", 8], ["Root crop farmer", 5],
  ["Fruit farmer", 4], ["Livestock farmer", 4], ["Poultry farmer", 4], ["Integrated farmer", 3], ["Cacao farmer", 1], ["Aquaculture farmer", 1],
];
function pickType() {
  const total = TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [name, w] of TYPE_WEIGHTS) if ((r -= w) < 0) return name;
  return "Rice farmer";
}

// ---------- the lists ----------
const barangays = await must(sb.from("barangays").select("id, name").eq("is_active", true).order("id"), "barangays");
const typeId = new Map((await must(sb.from("farmer_types").select("id, name"), "farmer types")).map((t) => [t.name, t.id]));
const faProfiles = await must(sb.from("profiles").select("id, barangay_id").eq("role", "fa_president"), "FA Presidents");
const faOf = new Map(faProfiles.filter((p) => p.barangay_id).map((p) => [p.barangay_id, p.id]));
const takenRsbsa = new Set((await must(sb.from("farmers").select("rsbsa_no"), "RSBSA numbers")).map((f) => f.rsbsa_no));

// Active farmers per barangay (by the address's barangay).
const active = await must(sb.from("addresses").select("barangay_id, farmers!inner ( status, deleted_at )").eq("farmers.status", "active").is("farmers.deleted_at", null), "active farmers");
const countOf = new Map();
for (const a of active) if (a.barangay_id) countOf.set(a.barangay_id, (countOf.get(a.barangay_id) ?? 0) + 1);

let seq = 300000 + ledger.farmers.length;
const nextRsbsa = (brgyId) => {
  let n;
  do {
    seq += 1;
    n = `09-73-00-${String(brgyId).padStart(3, "0")}-${String(seq).padStart(6, "0")}`;
  } while (takenRsbsa.has(n));
  takenRsbsa.add(n);
  return n;
};

let added = 0;
let sitiosAdded = 0;
for (const b of barangays) {
  const have = countOf.get(b.id) ?? 0;
  const need = Math.max(0, TARGET - have);
  if (!need) {
    console.log(`${b.name}: ${have} Active farmers already`);
    continue;
  }

  // Sitios/puroks (Purok 1–5 when the barangay has none).
  let sitios = await must(sb.from("sitios").select("id, name").eq("barangay_id", b.id).eq("is_active", true), `sitios of ${b.name}`);
  if (!sitios.length) {
    if (DRY) {
      sitios = [1, 2, 3, 4, 5].map((n) => ({ id: null, name: `Purok ${n}` }));
    } else {
      sitios = await must(
        sb.from("sitios").insert([1, 2, 3, 4, 5].map((n) => ({ name: `Purok ${n}`, barangay_id: b.id, created_by: faOf.get(b.id) ?? null }))).select("id, name"),
        `add sitios of ${b.name}`,
      );
      ledger.sitios.push(...sitios.map((s) => s.id));
      sitiosAdded += sitios.length;
      saveLedger();
    }
  }

  const people = Array.from({ length: need }, () => {
    const female = rand() < 0.45;
    const year = 1952 + Math.floor(rand() * 50);
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    const first = pickType();
    const types = [first];
    if (rand() < 0.3) {
      const second = pickType();
      if (second !== first) types.push(second);
    }
    const sitio = pick(sitios);
    return {
      farmer: {
        rsbsa_no: nextRsbsa(b.id),
        first_name: pick(female ? FEMALE : MALE),
        middle_name: rand() < 0.85 ? pick(MIDDLE) : null,
        surname: pick(SURNAMES),
        sex: female ? "female" : "male",
        birth_date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        contact_no: `09${String(Math.floor(between(100000000, 999999999))).padStart(9, "0")}`,
        // About one in ten is Inactive.
        status: rand() < 0.1 ? "inactive" : "active",
      },
      sitio,
      size: Math.round(between(types.includes("Rice farmer") || types.includes("Corn farmer") ? 0.5 : 0.25, 3.2) * 100) / 100,
      ownership: pick(OWNERSHIP),
      pcic: rand() < 0.4,
      types,
    };
  });
  // Top up so the barangay really has `need` more Active farmers.
  const inactive = people.filter((p) => p.farmer.status === "inactive").length;
  for (let i = 0; i < inactive; i++) {
    const extra = { ...people[i % people.length], farmer: { ...people[i % people.length].farmer, rsbsa_no: nextRsbsa(b.id), first_name: pick(MALE), status: "active" } };
    people.push(extra);
  }

  if (DRY) {
    console.log(`${b.name}: would add ${people.length} farmers (${need} more Active)`);
    added += people.length;
    continue;
  }
  const rows = await must(sb.from("farmers").insert(people.map((p) => p.farmer)).select("farmer_id, rsbsa_no"), `farmers of ${b.name}`);
  const idOf = new Map(rows.map((r) => [r.rsbsa_no, r.farmer_id]));
  ledger.farmers.push(...rows.map((r) => r.farmer_id));
  saveLedger();
  await must(
    sb.from("addresses").insert(people.map((p) => ({ farmer_id: idOf.get(p.farmer.rsbsa_no), street: p.sitio.name, sitio_id: p.sitio.id, barangay: b.name, barangay_id: b.id, municipality: "Labangan", province: "Zamboanga del Sur" }))),
    `addresses of ${b.name}`,
  );
  await must(
    sb.from("farm_parcels").insert(people.map((p) => ({ farmer_id: idOf.get(p.farmer.rsbsa_no), farm_location: p.sitio.name, sitio_id: p.sitio.id, farm_size_hectares: p.size, ownership_type: p.ownership, is_pcic_insured: p.pcic }))),
    `parcels of ${b.name}`,
  );
  await must(
    sb.from("farmer_farmer_types").insert(people.flatMap((p) => p.types.map((t) => ({ farmer_id: idOf.get(p.farmer.rsbsa_no), farmer_type_id: typeId.get(t) })))),
    `types of ${b.name}`,
  );
  added += rows.length;
  console.log(`${b.name}: added ${rows.length} farmers (now ${have + need}+ Active)`);
}
console.log(`\n${DRY ? "Would add" : "Added"} ${added} sample farmers${sitiosAdded ? ` and ${sitiosAdded} sitios/puroks` : ""}.`);

// ---------- Login accounts and profile pictures ----------
// Every sample farmer gets a mobile login (login ID = last 6 digits of the
// RSBSA number, password password123) and an illustrated profile picture,
// like the test farmers. Other farmers with a login but no picture get one
// too — never the stand-ins for Maui Pelaez, Claude Oclarit and Luna Cuizon.
const PROTECTED = new Set(["09-73-00-000-000537", "09-73-00-000-000612", "09-73-00-000-000389"]);
const EMAIL_DOMAIN = "farmers.agrishare.ph"; // same as manage-farmer-account
const AVATAR_BG = "e3efe0,dff1ec,e3ecf8,fbefd9";
const AVATAR_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // same as the farmer app
ledger.authUsers ??= [];
ledger.avatars ??= [];
ledger.picturesFor ??= [];
const { default: sharp } = await import("sharp");

async function renderAvatar(seedText, first, last) {
  try {
    const res = await fetch(`https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(seedText)}&size=512&backgroundColor=${AVATAR_BG}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svg = Buffer.from(await res.arrayBuffer());
    return await sharp(svg, { density: 144 }).resize(512, 512).flatten({ background: "#e3efe0" }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    // Offline: an initials picture.
    const bg = ["#4c9a5f", "#2a9d8f", "#4a7fc1", "#d99a2b"][seedText.length % 4];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${bg}"/><text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="200" font-weight="600" fill="#ffffff">${`${first[0]}${last[0]}`.toUpperCase()}</text></svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  }
}

// A few at a time.
async function eachLimited(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const sampleIds = new Set(ledger.farmers);
const everyone = [];
for (let from = 0; ; from += 1000) {
  const page = await must(sb.from("farmers").select("farmer_id, rsbsa_no, first_name, surname, contact_no, profile_id, profiles!profile_id ( avatar_url )").is("deleted_at", null).range(from, from + 999), "farmers");
  everyone.push(...page);
  if (page.length < 1000) break;
}
const needAccount = everyone.filter((f) => sampleIds.has(f.farmer_id) && !f.profile_id);
// On live only the sample farmers get pictures (real farmers are never touched).
const needPicture = everyone.filter((f) => !PROTECTED.has(f.rsbsa_no) && (sampleIds.has(f.farmer_id) || (!LIVE && f.profile_id)) && !f.profiles?.avatar_url);
if (DRY) {
  console.log(`Would add ${needAccount.length} logins and ${needPicture.length} profile pictures.`);
  process.exit(0);
}

let accounts = 0;
let pictures = 0;
const problems = [];
await eachLimited(needAccount, 6, async (f) => {
  const loginId = f.rsbsa_no.replace(/\D/g, "").slice(-6);
  const { data, error } = await sb.auth.admin.createUser({
    email: `${loginId}@${EMAIL_DOMAIN}`,
    password: "password123",
    email_confirm: true,
    user_metadata: { full_name: `${f.first_name} ${f.surname}`, contact_no: f.contact_no },
    app_metadata: { sample_batch: "barangay-sample" },
  });
  if (error) {
    problems.push(`${f.rsbsa_no}: ${error.message}`);
    return;
  }
  ledger.authUsers.push(data.user.id);
  await must(sb.from("farmers").update({ profile_id: data.user.id }).eq("farmer_id", f.farmer_id), `link login ${f.rsbsa_no}`);
  await must(sb.from("profiles").update({ must_change_password: false }).eq("id", data.user.id), `reminder ${f.rsbsa_no}`);
  f.profile_id = data.user.id;
  accounts++;
  if (accounts % 50 === 0) {
    saveLedger();
    console.log(`  ${accounts} logins…`);
  }
});
saveLedger();

await eachLimited(needPicture.filter((f) => f.profile_id), 6, async (f) => {
  const buf = await renderAvatar(f.rsbsa_no, f.first_name, f.surname);
  const objPath = `${f.profile_id}/avatar.jpg`; // same path as the farmer app
  const { error: upErr } = await sb.storage.from("avatars").upload(objPath, buf, { contentType: "image/jpeg", upsert: true });
  if (upErr) {
    problems.push(`${f.rsbsa_no} picture: ${upErr.message}`);
    return;
  }
  ledger.avatars.push(objPath);
  if (!sampleIds.has(f.farmer_id)) ledger.picturesFor.push(f.profile_id);
  const { data: signed, error: signErr } = await sb.storage.from("avatars").createSignedUrl(objPath, AVATAR_TTL_SECONDS);
  if (signErr) {
    problems.push(`${f.rsbsa_no} picture link: ${signErr.message}`);
    return;
  }
  await must(sb.from("profiles").update({ avatar_url: signed.signedUrl }).eq("id", f.profile_id), `picture ${f.rsbsa_no}`);
  pictures++;
  if (pictures % 50 === 0) {
    saveLedger();
    console.log(`  ${pictures} pictures…`);
  }
});
saveLedger();
console.log(`Added ${accounts} logins and ${pictures} profile pictures.${problems.length ? `\nProblems (${problems.length}):\n  ${problems.slice(0, 10).join("\n  ")}` : ""}`);
console.log(`Ledger: ${LEDGER}`);

// Removes ONLY the test data created by seed-test-data.mjs.
//
//   cd backend
//   node scripts/cleanup-test-data.mjs --dry-run   # show what would be removed
//   node scripts/cleanup-test-data.mjs             # remove it
//
// Works from test-data.ledger.json and re-checks every row against its
// natural key (RSBSA number, program + date, title, login email/seed tag)
// before deleting, so it can never remove a real record. Also removes what
// the seeded accounts created while testing (requests, submissions, uploads,
// tags on other distributions, audit entries). Maui Pelaez, Claude Oclarit
// and Luna Cuizon and their own records are never touched — only the seeded
// rows that reference them go. If a test account changed a real record
// (e.g. the test FA President forwarded a real farmer's request), cleanup
// stops and lists it instead of editing that record.
import fs from "node:fs";
import {
  BATCH, DATA_FILE, AUDITED, StopError,
  adminClient, loadLedger, saveLedger, emptyLedger, must, chunk,
} from "./test-data-common.mjs";

const DRY = process.argv.includes("--dry-run");
const sb = adminClient();
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const ledger = loadLedger();
const log = (...a) => console.log(...a);
const removed = {};
const count = (k, n) => { if (n) removed[k] = (removed[k] ?? 0) + n; };

async function selectIn(table, cols, column, ids, extra = (q) => q) {
  const out = [];
  for (const part of chunk([...new Set(ids)])) {
    if (part.length) out.push(...await must(extra(sb.from(table).select(cols).in(column, part)), `read ${table}`));
  }
  return out;
}
async function deleteIn(table, column, ids, label = table) {
  const list = [...new Set(ids)];
  if (DRY) { count(label, list.length); return; }
  let n = 0;
  for (const part of chunk(list)) {
    if (!part.length) continue;
    const rows = await must(sb.from(table).delete().in(column, part).select(column), `delete ${table}`);
    n += rows.length;
  }
  count(label, n);
}

async function main() {
  log(`${DRY ? "DRY RUN — nothing will be removed. " : ""}Cleaning up ${BATCH}…`);
  const realRsbsa = new Set(data.existing_farmers_used.map((e) => e.rsbsa_number));
  const seededRsbsa = new Set(data.farmers.map((f) => f.rsbsa_number));

  // ---------- 1. Verify every ledger entry is still the seeded record ----------
  const farmerRows = await selectIn("farmers", "farmer_id, rsbsa_no, profile_id", "farmer_id", ledger.farmers.map((f) => f.farmer_id));
  for (const f of ledger.farmers) {
    const row = farmerRows.find((r) => r.farmer_id === f.farmer_id);
    if (!row) continue; // already gone
    if (row.rsbsa_no !== f.rsbsa_no || !seededRsbsa.has(row.rsbsa_no) || realRsbsa.has(row.rsbsa_no)) {
      throw new StopError(`Farmer ${f.farmer_id} is now ${row.rsbsa_no}, not the seeded ${f.rsbsa_no}. Not deleting it.`);
    }
  }
  const farmerIds = farmerRows.map((r) => r.farmer_id);

  const users = [];
  for (const u of ledger.authUsers) {
    const { data: got, error } = await sb.auth.admin.getUserById(u.id);
    if (error || !got?.user) continue; // already gone
    if (got.user.app_metadata?.seed_batch !== BATCH || got.user.email !== u.email) {
      throw new StopError(`Account ${u.email} (${u.id}) is not tagged as seed ${BATCH}. Not deleting it.`);
    }
    users.push(got.user);
  }
  const profileIds = users.map((u) => u.id);

  const eventRows = await selectIn("distribution_events", "event_id, program_name, event_date", "event_id", ledger.events.map((e) => e.event_id));
  for (const e of ledger.events) {
    const row = eventRows.find((r) => r.event_id === e.event_id);
    if (row && (row.program_name !== e.program_name || row.event_date !== e.event_date)) {
      throw new StopError(`Distribution ${e.event_id} is now "${row.program_name}" ${row.event_date}, not the seeded one. Not deleting it.`);
    }
  }
  const eventIds = eventRows.map((r) => r.event_id);

  const annRows = await selectIn("announcements", "announcement_id, title", "announcement_id", ledger.announcements.map((a) => a.announcement_id));
  for (const a of ledger.announcements) {
    const row = annRows.find((r) => r.announcement_id === a.announcement_id);
    if (row && row.title !== a.title) throw new StopError(`Announcement ${a.announcement_id} is now "${row.title}". Not deleting it.`);
  }

  const comRows = await selectIn("commodities", "commodity_id, name", "commodity_id", ledger.commodities.map((c) => c.commodity_id));
  for (const c of ledger.commodities) {
    const row = comRows.find((r) => r.commodity_id === c.commodity_id);
    if (row && row.name !== c.name) throw new StopError(`Commodity ${c.commodity_id} is now "${row.name}". Not deleting it.`);
  }

  const cvRows = await selectIn("crop_validations", "validation_id, farmer_id", "validation_id", ledger.cropValidations.map((v) => v.validation_id));
  for (const v of ledger.cropValidations) {
    const row = cvRows.find((r) => r.validation_id === v.validation_id);
    if (row && row.farmer_id !== v.farmer_id) throw new StopError(`Submission ${v.validation_id} now belongs to farmer ${row.farmer_id}. Not deleting it.`);
  }

  // ---------- 2. What to remove: ledger rows + test activity by seeded accounts ----------
  const requestIds = [
    ...ledger.requests,
    ...(await selectIn("requests", "request_id", "farmer_id", farmerIds)).map((r) => r.request_id),
  ];
  const validationIds = [
    ...cvRows.map((r) => r.validation_id),
    ...(await selectIn("crop_validations", "validation_id", "farmer_id", farmerIds)).map((r) => r.validation_id),
  ];
  // Seeded farmers tagged onto distributions that aren't seeded: drop only those tags.
  const strayClaims = (await selectIn("distribution_claims", "claim_id, event_id", "farmer_id", farmerIds)).filter((c) => !eventIds.includes(c.event_id));
  const seededClaims = await selectIn("distribution_claims", "claim_id", "event_id", eventIds);
  const claimIds = [...strayClaims.map((c) => c.claim_id), ...seededClaims.map((c) => c.claim_id)];

  // ---------- 3. Stop if a real record would have to change ----------
  const blockers = [];
  const notIn = (ids) => (row, key) => !ids.includes(row[key]);
  const checkRefs = async (table, key, cols, keep) => {
    for (const col of cols) {
      const rows = await selectIn(table, `${key}, ${col}`, col, profileIds);
      rows.filter((r) => keep(r, key)).forEach((r) => blockers.push(`${table} ${r[key]} (${col} = test account)`));
    }
  };
  await checkRefs("requests", "request_id", ["reviewed_by_fa", "reviewed_by_mao"], notIn(requestIds));
  await checkRefs("crop_validations", "validation_id", ["reviewed_by"], notIn(validationIds));
  await checkRefs("distribution_events", "event_id", ["created_by", "status_updated_by", "deleted_by"], notIn(eventIds));
  await checkRefs("distribution_claims", "claim_id", ["released_by"], notIn(claimIds));
  await checkRefs("farmers", "farmer_id", ["created_by", "deleted_by"], notIn(farmerIds));
  await checkRefs("announcements", "announcement_id", ["forwarded_by"], notIn(annRows.map((a) => a.announcement_id)));
  await checkRefs("org_settings", "id", ["updated_by"], () => true);
  const realOnSeededClaims = (await selectIn("crop_validations", "validation_id, distribution_claim_id", "distribution_claim_id", claimIds))
    .filter((r) => !validationIds.includes(r.validation_id));
  realOnSeededClaims.forEach((r) => blockers.push(`crop_validations ${r.validation_id} (linked to a seeded distribution claim)`));
  if (blockers.length) {
    throw new StopError(`These real records reference test data and would have to change:\n  - ${blockers.join("\n  - ")}\nNothing was removed. Decide how to handle them, then re-run.`);
  }

  // Seed-created commodities still used by real records stay.
  const comIds = comRows.map((r) => r.commodity_id);
  const usedBy = async (table, key, dropIds) => (await selectIn(table, `${key}, commodity_id`, "commodity_id", comIds)).filter((r) => !dropIds.includes(r[key])).map((r) => r.commodity_id);
  const itemIdsOfSeededEvents = (await selectIn("distribution_event_items", "event_item_id", "event_id", eventIds)).map((r) => r.event_item_id);
  const stillUsed = new Set([
    ...await usedBy("distribution_event_items", "event_item_id", itemIdsOfSeededEvents),
    ...await usedBy("distribution_claims", "claim_id", claimIds),
    ...await usedBy("requests", "request_id", requestIds),
  ]);
  const comToDelete = comIds.filter((id) => !stillUsed.has(id));
  for (const id of stillUsed) log(`Keeping commodity ${comRows.find((c) => c.commodity_id === id).name}: real records use it now.`);

  // Files: ledger paths + anything else the seeded accounts uploaded.
  const files = { avatars: new Set(), "crop-validation-photos": new Set() };
  ledger.storage.forEach((s) => files[s.bucket]?.add(s.path));
  for (const [bucket, folders] of [["avatars", profileIds], ["crop-validation-photos", farmerIds.map(String)]]) {
    for (const folder of folders) {
      const { data: objs, error } = await sb.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`);
      objs.filter((o) => o.id).forEach((o) => files[bucket].add(`${folder}/${o.name}`));
    }
  }

  // ---------- 4. Remove (children first) ----------
  const auditMark = (await must(sb.from("audit_logs").select("log_id").order("log_id", { ascending: false }).limit(1), "audit watermark"))[0]?.log_id ?? 0;
  await deleteIn("user_notifications", "id", ledger.notifications);
  await deleteIn("announcements", "announcement_id", annRows.map((a) => a.announcement_id));
  await deleteIn("requests", "request_id", requestIds);
  await deleteIn("crop_validations", "validation_id", validationIds);
  await deleteIn("distribution_claims", "claim_id", strayClaims.map((c) => c.claim_id), "distribution_claims (on real distributions)");
  if (DRY) { count("distribution_claims", seededClaims.length); count("distribution_event_items", itemIdsOfSeededEvents.length); }
  await deleteIn("distribution_events", "event_id", eventIds, "distribution_events (+ their items and claims)");
  if (DRY) {
    count("addresses / farm_parcels / crops (cascade)", (await selectIn("addresses", "address_id", "farmer_id", farmerIds)).length);
  }
  await deleteIn("farmers", "farmer_id", farmerIds, "farmers (+ addresses, parcels, crops)");
  await deleteIn("commodities", "commodity_id", comToDelete);

  for (const [bucket, set] of Object.entries(files)) {
    const paths = [...set];
    if (!paths.length) continue;
    if (!DRY) {
      for (const part of chunk(paths)) {
        const { error } = await sb.storage.from(bucket).remove(part);
        if (error) throw new Error(`remove ${bucket} files: ${error.message}`);
      }
    }
    count(`storage ${bucket}`, paths.length);
  }

  // Audit entries: the seed's, the seeded accounts' own actions, and the
  // ones this cleanup's deletes just generated.
  const auditIds = new Set(ledger.auditLogs);
  (await selectIn("audit_logs", "log_id", "actor_id", profileIds)).forEach((r) => auditIds.add(r.log_id));
  if (!DRY) {
    const idsFor = {
      farmers: farmerIds, commodities: comToDelete, distribution_events: eventIds, distribution_event_items: itemIdsOfSeededEvents,
      distribution_claims: claimIds, crop_validations: validationIds, requests: requestIds, announcements: annRows.map((a) => a.announcement_id),
    };
    for (const [table, pk] of Object.entries(AUDITED)) {
      for (const ids of chunk([...new Set(idsFor[table])].map(String))) {
        if (!ids.length) continue;
        const rows = await must(sb.from("audit_logs").select("log_id").eq("table_name", table).gt("log_id", auditMark).is("actor_id", null).in(`details->>${pk}`, ids), `audit ${table}`);
        rows.forEach((r) => auditIds.add(r.log_id));
      }
    }
  }
  await deleteIn("audit_logs", "log_id", [...auditIds]);

  // Accounts last (their profiles, notifications and reads cascade).
  if (!DRY) {
    for (const u of users) {
      const { error } = await sb.auth.admin.deleteUser(u.id);
      if (error) throw new Error(`delete account ${u.email}: ${error.message}`);
    }
  }
  count("auth accounts (+ profiles, their notifications)", users.length);

  if (!DRY) saveLedger({ ...emptyLedger(), lastCleanup: new Date().toISOString() });

  log(`\n${DRY ? "Would remove" : "Removed"}:`);
  if (!Object.keys(removed).length) log("  nothing (no test data found)");
  for (const [k, n] of Object.entries(removed)) log(`  ${k.padEnd(46)} ${n}`);
}

// Exit explicitly: an idle keep-alive connection must not hold the process open.
main().then(() => process.exit(0)).catch((err) => {
  console.error(err instanceof StopError ? `\nSTOPPED: ${err.message}` : `\nCLEANUP FAILED: ${err.message}`);
  process.exit(err instanceof StopError ? 2 : 1);
});

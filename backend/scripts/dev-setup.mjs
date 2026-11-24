// AGRISHARE_DB=dev node backend/scripts/dev-setup.mjs
//
// Prepares the development database (agrishare-dev) for the test data:
//   * a dev MAO Admin (admin@agrishare.test / password123) — live has the
//     real MAO Admin, which the seed only references;
//   * stand-ins for the three existing farmers the test data links to by
//     RSBSA number (live has the real records; the dev copies get neutral
//     names, no login and no personal details — only a farm size big enough
//     for the seeded harvest reports and proof of planting).
// Then run: AGRISHARE_DB=dev node backend/scripts/seed-test-data.mjs
//
// Refuses to run against the live project. Safe to run again (skips what
// exists).
import fs from "node:fs";
import { DATA_FILE, TARGET, adminClient } from "./test-data-common.mjs";

if (TARGET !== "dev") {
  console.error("dev-setup.mjs only runs against the development database: AGRISHARE_DB=dev node backend/scripts/dev-setup.mjs");
  process.exit(2);
}
const sb = adminClient();
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const must = async (q, what) => {
  const { data: rows, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return rows;
};

// ---- dev MAO Admin
const ADMIN = { email: "admin@agrishare.test", password: "password123", name: "MAO Admin (dev)" };
const admins = await must(sb.from("profiles").select("id").eq("role", "mao_admin"), "MAO admins");
if (admins.length) {
  console.log(`MAO Admin: already there (${admins.length})`);
} else {
  const { error } = await sb.auth.admin.createUser({
    email: ADMIN.email, password: ADMIN.password, email_confirm: true,
    user_metadata: { full_name: ADMIN.name },
    app_metadata: { role: "mao_admin" },
  });
  if (error) throw new Error(`create MAO Admin: ${error.message}`);
  console.log(`MAO Admin: created ${ADMIN.email}`);
}

// ---- stand-ins for the existing farmers (by RSBSA number)
const langapud = (await must(sb.from("barangays").select("id").eq("name", "Langapod"), "Langapod"))[0]?.id;
const FARM_HA = { "09-73-00-000-000537": 65, "09-73-00-000-000612": 4, "09-73-00-000-000389": 12 };
for (const [i, e] of data.existing_farmers_used.entries()) {
  const ha = FARM_HA[e.rsbsa_number] ?? 5;
  const found = await must(sb.from("farmers").select("farmer_id").eq("rsbsa_no", e.rsbsa_number), `farmer ${e.rsbsa_number}`);
  if (found.length) {
    await must(sb.from("farm_parcels").update({ farm_size_hectares: ha }).eq("farmer_id", found[0].farmer_id), "stand-in farm size");
    await must(sb.from("crops").update({ area_planted: ha }).in("parcel_id", (await must(sb.from("farm_parcels").select("parcel_id").eq("farmer_id", found[0].farmer_id), "parcels")).map((p) => p.parcel_id)), "stand-in crop area");
    console.log(`Stand-in ${e.rsbsa_number}: already there (${ha} ha)`);
    continue;
  }
  const digits = e.rsbsa_number.slice(-6);
  const farmer = (await must(sb.from("farmers").insert({
    rsbsa_no: e.rsbsa_number, first_name: "Sample", surname: `Farmer ${digits}`, sex: i % 2 ? "male" : "female",
    birth_date: "1980-01-01", status: "active",
  }).select("farmer_id").single(), `stand-in ${digits}`));
  await must(sb.from("addresses").insert({ farmer_id: farmer.farmer_id, street: "Purok 2", barangay: "Langapod", barangay_id: langapud, municipality: "Labangan", province: "Zamboanga del Sur" }), "stand-in address");
  const parcel = await must(sb.from("farm_parcels").insert({ farmer_id: farmer.farmer_id, farm_location: "Purok 2", farm_size_hectares: ha, ownership_type: "Owner" }).select("parcel_id").single(), "stand-in parcel");
  await must(sb.from("crops").insert({ parcel_id: parcel.parcel_id, crop_type: "Rice", area_planted: ha }), "stand-in crop");
  console.log(`Stand-in ${e.rsbsa_number}: created (Sample Farmer ${digits}, ${ha} ha)`);
}
console.log("Done. Next: AGRISHARE_DB=dev node backend/scripts/seed-test-data.mjs");
process.exit(0);

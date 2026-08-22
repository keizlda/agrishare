// Seeds the local Supabase instance with data matching the mock data already
// used in the web/mobile frontends, so switching them over to real Supabase
// queries doesn't change what's on screen for the demo.
//
// Run against local dev by default. To seed a real cloud project instead,
// set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars before running.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "password123";

async function createAuthUser({ email, fullName, role, contactNo }) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role, contact_no: contactNo },
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  return data.user.id;
}

async function main() {
  console.log("Seeding AgriShare demo data into", SUPABASE_URL);

  // ---- Staff accounts ----
  await createAuthUser({ email: "admin@labangan.gov.ph", fullName: "Admin", role: "mao_admin" });
  await createAuthUser({ email: "fapresident@langapud.gov.ph", fullName: "FA President", role: "fa_president" });
  console.log("Created MAO Admin + FA President accounts");

  // ---- Farmers (matches web/src/data/mockData.js) ----
  const farmerSeeds = [
    { rsbsaNo: "2024-01-002-000123", firstName: "Juan", lastName: "Dela Cruz", sex: "male", birthDate: "1978-01-22", contactNo: "0917 123 4567", commodity: "Rice", farmSize: 1.5, status: "active", validationStatus: "validated" },
    { rsbsaNo: "2024-01-002-000124", firstName: "Maria", lastName: "Santos", sex: "female", birthDate: "1976-06-14", contactNo: "0921 987 6543", commodity: "Corn", farmSize: 2.0, status: "active", validationStatus: "pending" },
    { rsbsaNo: "2024-01-002-000125", firstName: "Pedro", lastName: "Reyes", sex: "male", birthDate: "1972-02-10", contactNo: "0918 765 4321", commodity: "Vegetables", farmSize: 0.75, status: "inactive", validationStatus: "not_validated" },
    { rsbsaNo: "2024-01-002-000126", firstName: "Ana", lastName: "Mendoza", sex: "female", birthDate: "1982-03-05", contactNo: "0906 234 5678", commodity: "Rice", farmSize: 1.2, status: "active", validationStatus: "validated" },
    { rsbsaNo: "2024-01-002-000127", firstName: "Rogelio", lastName: "Torres", sex: "male", birthDate: "1975-05-17", contactNo: "0915 345 6789", commodity: "Corn", farmSize: 2.5, status: "active", validationStatus: "validated" },
    { rsbsaNo: "2024-01-002-000128", firstName: "Liza", lastName: "Ramirez", sex: "female", birthDate: "1973-10-28", contactNo: "0932 456 7890", commodity: "Vegetables", farmSize: 0.6, status: "active", validationStatus: "pending" },
    { rsbsaNo: "2024-01-002-000129", firstName: "Mario", lastName: "Bautista", sex: "male", birthDate: "1971-11-01", contactNo: "0919 567 8901", commodity: "Rice", farmSize: 1.8, status: "inactive", validationStatus: "not_validated" },
  ];

  const farmerIdByRsbsa = {};
  for (const f of farmerSeeds) {
    const syntheticEmail = `${f.rsbsaNo.replace(/[^a-z0-9]/gi, "")}@farmer.agrishare.local`;
    const profileId = await createAuthUser({
      email: syntheticEmail,
      fullName: `${f.firstName} ${f.lastName}`,
      role: "farmer",
      contactNo: f.contactNo,
    });

    const { data: farmerRow, error: farmerErr } = await supabase
      .from("farmers")
      .insert({
        profile_id: profileId,
        rsbsa_no: f.rsbsaNo,
        surname: f.lastName,
        first_name: f.firstName,
        sex: f.sex,
        birth_date: f.birthDate,
        contact_no: f.contactNo,
        status: f.status,
        validation_status: f.validationStatus,
      })
      .select("farmer_id")
      .single();
    if (farmerErr) throw new Error(`insert farmer ${f.rsbsaNo} failed: ${farmerErr.message}`);
    farmerIdByRsbsa[f.rsbsaNo] = farmerRow.farmer_id;

    await supabase.from("addresses").insert({ farmer_id: farmerRow.farmer_id, barangay: "Langapud", municipality: "Labangan", province: "Zamboanga del Sur" });
    const { data: parcel } = await supabase
      .from("farm_parcels")
      .insert({ farmer_id: farmerRow.farmer_id, farm_location: "Langapud", farm_size_hectares: f.farmSize })
      .select("parcel_id")
      .single();
    if (parcel) {
      await supabase.from("crops").insert({ parcel_id: parcel.parcel_id, crop_type: f.commodity, area_planted: f.farmSize });
    }
  }
  console.log(`Created ${farmerSeeds.length} farmer accounts + profiles`);

  // ---- Commodities (matches web mock, minus stock — out of scope) ----
  const commoditySeeds = [
    { name: "Rice Seeds (NSIC Rc222)", category: "Rice" },
    { name: "Corn Seeds", category: "Corn" },
    { name: "Fertilizer", category: "Fertilizer" },
    { name: "Organic Fertilizer", category: "Fertilizer" },
    { name: "Bio Plant Activator", category: "Fertilizer" },
    { name: "Pesticide", category: "Fertilizer" },
    { name: "Farm Tools Set", category: "Farm Tools" },
    { name: "Vegetable Seeds", category: "Vegetables" },
    { name: "Livestock Assistance", category: "Livestock", status: "inactive" },
  ];
  const commodityIdByName = {};
  for (const c of commoditySeeds) {
    const { data, error } = await supabase
      .from("commodities")
      .insert({ name: c.name, category: c.category, status: c.status ?? "active" })
      .select("commodity_id")
      .single();
    if (error) throw new Error(`insert commodity ${c.name} failed: ${error.message}`);
    commodityIdByName[c.name] = data.commodity_id;
  }
  console.log(`Created ${commoditySeeds.length} commodities`);

  // ---- Distribution events + items + a few real claims ----
  const eventSeeds = [
    { program: "RCEF Seed Distribution", date: "2024-05-20", venue: "Barangay Hall", status: "completed", beneficiaries: 120, items: [["Rice Seeds (NSIC Rc222)", 2400], ["Organic Fertilizer", 600], ["Bio Plant Activator", 120]], claims: [["2024-01-002-000123", "Rice Seeds (NSIC Rc222)", 50]] },
    { program: "Corn Seeds Distribution", date: "2024-05-18", venue: "Villa Verde Covered Court", status: "completed", beneficiaries: 98, items: [["Corn Seeds", 1960]], claims: [["2024-01-002-000124", "Corn Seeds", 30]] },
    { program: "High-Value Crops Program", date: "2024-05-15", venue: "San Isidro Barangay Hall", status: "ongoing", beneficiaries: 150, items: [["Vegetable Seeds", 3000]], claims: [] },
    { program: "RCEF Seed Distribution", date: "2024-05-12", venue: "Poblacion Hall", status: "completed", beneficiaries: 85, items: [["Rice Seeds (NSIC Rc222)", 510]], claims: [] },
    { program: "Vegetable Seeds Distribution", date: "2024-06-05", venue: "Barangay Hall", status: "scheduled", beneficiaries: 130, items: [["Vegetable Seeds", 1500]], claims: [] },
  ];

  for (const ev of eventSeeds) {
    const { data: event, error: eventErr } = await supabase
      .from("distribution_events")
      .insert({ program_name: ev.program, event_date: ev.date, venue: ev.venue, status: ev.status, beneficiaries_count: ev.beneficiaries })
      .select("event_id")
      .single();
    if (eventErr) throw new Error(`insert event ${ev.program} failed: ${eventErr.message}`);

    for (const [commodityName, qty] of ev.items) {
      await supabase.from("distribution_event_items").insert({
        event_id: event.event_id,
        commodity_id: commodityIdByName[commodityName],
        quantity_allocated: qty,
      });
    }
    for (const [rsbsaNo, commodityName, qty] of ev.claims) {
      await supabase.from("distribution_claims").insert({
        event_id: event.event_id,
        commodity_id: commodityIdByName[commodityName],
        farmer_id: farmerIdByRsbsa[rsbsaNo],
        quantity_received: qty,
        acknowledged: true,
      });
    }
  }
  console.log(`Created ${eventSeeds.length} distribution events`);

  // ---- Commodity requests (matches web mock) ----
  const requestSeeds = [
    { rsbsaNo: "2024-01-002-000123", commodity: "Rice Seeds (NSIC Rc222)", qty: 50, reason: "For upcoming wet season planting on additional farm area.", status: "pending" },
    { rsbsaNo: "2024-01-002-000124", commodity: "Corn Seeds", qty: 30, reason: "Previous batch was damaged by pests before planting.", status: "forwarded", faRemarks: "Verified with farmer, requesting due to crop loss." },
    { rsbsaNo: "2024-01-002-000126", commodity: "Fertilizer", qty: 25, reason: "Additional fertilizer needed for second cropping cycle.", status: "approved", faRemarks: "Confirmed active farmer, recommending approval.", maoRemarks: "Approved for release during next distribution activity." },
    { rsbsaNo: "2024-01-002-000129", commodity: "Pesticide", qty: 10, reason: "Pest infestation reported in farm area.", status: "rejected", faRemarks: "Farmer currently marked inactive, forwarding for review.", maoRemarks: "Rejected — farmer status must be revalidated before new assistance." },
  ];
  for (const r of requestSeeds) {
    await supabase.from("requests").insert({
      farmer_id: farmerIdByRsbsa[r.rsbsaNo],
      commodity_id: commodityIdByName[r.commodity],
      quantity_requested: r.qty,
      reason: r.reason,
      status: r.status,
      fa_remarks: r.faRemarks ?? null,
      mao_remarks: r.maoRemarks ?? null,
    });
  }
  console.log(`Created ${requestSeeds.length} commodity requests`);

  // ---- Announcements (matches mobile mock) ----
  const announcementSeeds = [
    { title: "RCEF Seed Distribution on May 20", message: "This is to inform all farmers that RCEF seed distribution will be held on May 20, 2024 at the barangay hall." },
    { title: "Training on Sustainable Farming Practices", message: "A training session on sustainable farming practices will be conducted on May 25, 2024. All interested farmers are encouraged to participate." },
    { title: "Water Supply Maintenance", message: "Please be advised that there will be a scheduled maintenance of the irrigation system on May 22, 2024." },
    { title: "Fertilizer Availability Update", message: "Additional fertilizer stocks are now available. Please coordinate with your barangay coordinator for your requirements." },
  ];
  for (const a of announcementSeeds) {
    await supabase.from("notifications").insert({ title: a.title, message: a.message });
  }
  console.log(`Created ${announcementSeeds.length} announcements`);

  console.log("\nSeed complete. Login credentials (all use password:", PASSWORD + "):");
  console.log("  MAO Admin:    admin@labangan.gov.ph");
  console.log("  FA President: fapresident@langapud.gov.ph");
  console.log("  Farmer (Juan Dela Cruz): 202401002000123@farmer.agrishare.local  (or RSBSA No. 2024-01-002-000123 via the app's login screen)");
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});

import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

// Official RSBSA Enrollment Form (Revised 01-2024) format:
// RR-PP-MM-BBB-NNNNNN. Exported so the form's live mask, its submit-time
// validation, and the Farmers table's "invalid format" badge all check the
// exact same pattern.
export const RSBSA_PATTERN = /^\d{2}-\d{2}-\d{2}-\d{3}-\d{6}$/;
export function isValidRsbsaFormat(rsbsaNo) {
  return RSBSA_PATTERN.test((rsbsaNo ?? "").trim());
}

const SELECT = `
  farmer_id, profile_id, rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no,
  household_head, household_members, org_affiliation, status, validation_status, created_at,
  addresses ( street, barangay, municipality, province ),
  farm_parcels ( farm_location, farm_size_hectares, ownership_type, is_pcic_insured, livestock_details, crops ( crop_type ) )
`;

// manage-farmer-account (Edge Function): creates/updates/resets/disables a
// farmer's mobile login. Runs with the service role key server-side — never
// callable directly with the anon key's privileges from here beyond invoke.
async function invokeAccountFn(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("manage-farmer-account", { body: { action, ...payload } });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) message = body.error;
    } catch {
      // fall back to error.message below
    }
    throw new Error(message);
  }
  return data;
}

// Pre-save check the form calls before writing anything, so a conflicting
// RSBSA number blocks the save instead of failing after the farmer record
// (and possibly an account) has already been created.
export async function checkLoginIdAvailable(rsbsaNo, excludeFarmerId) {
  return invokeAccountFn("check-login-id", { rsbsaNo, excludeFarmerId });
}

export async function resetFarmerPassword(farmerId) {
  return invokeAccountFn("reset-password", { farmerId });
}

function pcicLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not Applicable";
}

function pcicDbValue(label) {
  if (label === "Yes") return true;
  if (label === "No") return false;
  return null;
}

function mapFarmer(row) {
  const address = row.addresses?.[0];
  const parcel = row.farm_parcels?.[0];
  return {
    id: row.farmer_id,
    profileId: row.profile_id,
    rsbsaNo: row.rsbsa_no,
    rsbsaValid: isValidRsbsaFormat(row.rsbsa_no),
    firstName: row.first_name,
    middleName: row.middle_name ?? "",
    lastName: row.surname,
    sex: row.sex === "male" ? "Male" : "Female",
    birthDate: row.birth_date,
    contactNo: row.contact_no ?? "",
    sitioPurok: address?.street ?? "",
    barangay: address?.barangay ?? "Langapud",
    municipality: address?.municipality ?? "Labangan",
    province: address?.province ?? "Zamboanga del Sur",
    householdHead: row.household_head ? "Yes" : "No",
    householdMembers: row.household_members ?? "",
    commodity: parcel?.crops?.[0]?.crop_type ?? "",
    farmSize: parcel?.farm_size_hectares != null ? Number(parcel.farm_size_hectares) : 0,
    farmLocation: parcel?.farm_location ?? "",
    ownershipType: parcel?.ownership_type ?? "",
    pcicInsured: pcicLabel(parcel?.is_pcic_insured),
    livestockDetails: parcel?.livestock_details ?? "",
    orgAffiliation: row.org_affiliation ?? "",
    status: dbStatusToLabel(row.status),
    validationStatus: dbStatusToLabel(row.validation_status),
    dateRegistered: row.created_at?.slice(0, 10),
  };
}

export async function listFarmers() {
  const { data, error } = await supabase.from("farmers").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapFarmer);
}

export async function createFarmer(form) {
  const farmSize = Number(form.farmSize) || 0;

  const { data: farmerRow, error: farmerErr } = await supabase
    .from("farmers")
    .insert({
      rsbsa_no: form.rsbsaNo,
      surname: form.lastName,
      first_name: form.firstName,
      middle_name: form.middleName || null,
      sex: form.sex.toLowerCase(),
      birth_date: form.birthDate,
      contact_no: form.contactNo,
      household_head: form.householdHead === "Yes",
      household_members: form.householdMembers ? Number(form.householdMembers) : null,
      org_affiliation: form.orgAffiliation || null,
      status: labelToDbStatus(form.status || "Active"),
      validation_status: "pending",
    })
    .select(
      "farmer_id, rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no, household_head, household_members, org_affiliation, status, validation_status, created_at",
    )
    .single();
  if (farmerErr) throw farmerErr;

  const { error: addrErr } = await supabase.from("addresses").insert({
    farmer_id: farmerRow.farmer_id,
    street: form.sitioPurok || null,
    barangay: form.barangay,
    municipality: form.municipality,
    province: form.province,
  });
  if (addrErr) throw addrErr;

  const { data: parcel, error: parcelErr } = await supabase
    .from("farm_parcels")
    .insert({
      farmer_id: farmerRow.farmer_id,
      farm_location: form.farmLocation,
      farm_size_hectares: farmSize,
      ownership_type: form.ownershipType || null,
      is_pcic_insured: pcicDbValue(form.pcicInsured),
      livestock_details: form.livestockDetails || null,
    })
    .select("parcel_id")
    .single();
  if (parcelErr) throw parcelErr;

  const { error: cropErr } = await supabase
    .from("crops")
    .insert({ parcel_id: parcel.parcel_id, crop_type: form.commodity, area_planted: farmSize });
  if (cropErr) throw cropErr;

  // Account creation (manage-farmer-account) happens only once the farmer
  // record itself is fully written. A same-last-6-digits conflict here means
  // "no farmer without an account" would be violated, so the whole farmer
  // record (and its cascaded address/parcel/crop rows) is rolled back rather
  // than left half-provisioned. An out-of-format RSBSA (pre-existing records
  // being corrected later) just skips account creation for now — updateFarmer
  // creates the account the moment the number becomes valid.
  let account = null;
  if (isValidRsbsaFormat(form.rsbsaNo)) {
    try {
      account = await invokeAccountFn("create", {
        farmerId: farmerRow.farmer_id,
        rsbsaNo: form.rsbsaNo,
        fullName: `${form.firstName} ${form.lastName}`,
        contactNo: form.contactNo,
      });
    } catch (err) {
      await supabase.from("farmers").delete().eq("farmer_id", farmerRow.farmer_id).catch(() => {});
      throw err;
    }
  }

  return {
    ...mapFarmer({
      ...farmerRow,
      profile_id: account?.profileId ?? null,
      addresses: [{ street: form.sitioPurok, barangay: form.barangay, municipality: form.municipality, province: form.province }],
      farm_parcels: [
        {
          farm_location: form.farmLocation,
          farm_size_hectares: farmSize,
          ownership_type: form.ownershipType,
          is_pcic_insured: pcicDbValue(form.pcicInsured),
          livestock_details: form.livestockDetails,
          crops: [{ crop_type: form.commodity }],
        },
      ],
    }),
    loginId: account?.loginId ?? null,
    tempPassword: account?.password ?? null,
  };
}

export async function updateFarmer(farmerId, form) {
  const farmSize = Number(form.farmSize) || 0;

  const { data: previous, error: prevErr } = await supabase
    .from("farmers")
    .select("rsbsa_no, profile_id")
    .eq("farmer_id", farmerId)
    .single();
  if (prevErr) throw prevErr;

  const { error: farmerErr } = await supabase
    .from("farmers")
    .update({
      rsbsa_no: form.rsbsaNo,
      surname: form.lastName,
      first_name: form.firstName,
      middle_name: form.middleName || null,
      sex: form.sex.toLowerCase(),
      birth_date: form.birthDate,
      contact_no: form.contactNo,
      household_head: form.householdHead === "Yes",
      household_members: form.householdMembers ? Number(form.householdMembers) : null,
      org_affiliation: form.orgAffiliation || null,
      status: labelToDbStatus(form.status || "Active"),
    })
    .eq("farmer_id", farmerId);
  if (farmerErr) throw farmerErr;

  const { error: addrErr } = await supabase
    .from("addresses")
    .update({
      street: form.sitioPurok || null,
      barangay: form.barangay,
      municipality: form.municipality,
      province: form.province,
    })
    .eq("farmer_id", farmerId);
  if (addrErr) throw addrErr;

  const { data: parcel, error: parcelErr } = await supabase
    .from("farm_parcels")
    .update({
      farm_location: form.farmLocation,
      farm_size_hectares: farmSize,
      ownership_type: form.ownershipType || null,
      is_pcic_insured: pcicDbValue(form.pcicInsured),
      livestock_details: form.livestockDetails || null,
    })
    .eq("farmer_id", farmerId)
    .select("parcel_id")
    .single();
  if (parcelErr) throw parcelErr;

  const { error: cropErr } = await supabase
    .from("crops")
    .update({ crop_type: form.commodity, area_planted: farmSize })
    .eq("parcel_id", parcel.parcel_id);
  if (cropErr) throw cropErr;

  // The farmer record is already saved by this point, so a problem here is
  // reported back as a non-fatal notice rather than thrown — the edit itself
  // succeeded even if the login-ID side effect didn't. The Farmers page form
  // pre-checks availability before calling updateFarmer at all, so this is
  // mainly a defense against a race condition, not the primary guard.
  let accountNotice = null;
  const rsbsaChanged = previous.rsbsa_no !== form.rsbsaNo;
  if (rsbsaChanged && isValidRsbsaFormat(form.rsbsaNo)) {
    try {
      if (previous.profile_id) {
        const result = await invokeAccountFn("update-rsbsa", { farmerId, newRsbsaNo: form.rsbsaNo });
        accountNotice = { type: "login-id-changed", loginId: result.loginId };
      } else {
        const result = await invokeAccountFn("create", {
          farmerId,
          rsbsaNo: form.rsbsaNo,
          fullName: `${form.firstName} ${form.lastName}`,
          contactNo: form.contactNo,
        });
        accountNotice = { type: "account-created", loginId: result.loginId, password: result.password };
      }
    } catch (err) {
      accountNotice = { type: "error", message: err.message };
    }
  }

  const { data: fresh, error: fetchErr } = await supabase.from("farmers").select(SELECT).eq("farmer_id", farmerId).single();
  if (fetchErr) throw fetchErr;
  return { ...mapFarmer(fresh), accountNotice };
}

// Disabling the auth account is best-effort: the farmer record is the
// primary thing "Delete" promises to remove, and a flaky account-disable
// call shouldn't block that after the admin already confirmed the delete.
export async function deleteFarmer(farmerId) {
  const { data: farmer } = await supabase.from("farmers").select("profile_id").eq("farmer_id", farmerId).maybeSingle();

  const { error } = await supabase.from("farmers").delete().eq("farmer_id", farmerId);
  if (error) throw error;

  if (farmer?.profile_id) {
    await invokeAccountFn("delete", { profileId: farmer.profile_id }).catch((err) => {
      console.warn("Farmer deleted, but disabling their login account failed:", err.message);
    });
  }
}

export async function setFarmerStatus(farmerId, statusLabel) {
  const { error } = await supabase.from("farmers").update({ status: labelToDbStatus(statusLabel) }).eq("farmer_id", farmerId);
  if (error) throw error;
}

// Debounced typeahead for the beneficiary-tagging field (Distributions).
// Matches on name or RSBSA number; deliberately not the full listFarmers()
// select — this only needs to render a compact suggestion row.
const SEARCH_SELECT = "farmer_id, rsbsa_no, first_name, surname, status, validation_status, addresses ( barangay )";

function mapFarmerBrief(row) {
  return {
    id: row.farmer_id,
    rsbsaNo: row.rsbsa_no,
    firstName: row.first_name,
    lastName: row.surname,
    barangay: row.addresses?.[0]?.barangay ?? "Langapud",
    status: dbStatusToLabel(row.status),
    validationStatus: dbStatusToLabel(row.validation_status),
  };
}

export async function searchFarmers(query, limit = 8) {
  const q = query.trim();
  if (!q) return [];
  // A query typed as bare digits (with or without hyphens the admin may
  // have included) also matches rsbsa_digits, so "097312021000143" and
  // "09-73-12-021-000143" both find the same farmer as "09-73-12-021-000143".
  const digitsOnly = q.replace(/\D/g, "");
  const orClauses = [`first_name.ilike.%${q}%`, `surname.ilike.%${q}%`, `rsbsa_no.ilike.%${q}%`];
  if (digitsOnly) orClauses.push(`rsbsa_digits.ilike.%${digitsOnly}%`);
  const { data, error } = await supabase.from("farmers").select(SEARCH_SELECT).or(orClauses.join(",")).limit(limit);
  if (error) throw error;
  return data.map(mapFarmerBrief);
}

export async function setFarmerValidation(farmerId, validationStatusLabel) {
  const { error } = await supabase
    .from("farmers")
    .update({ validation_status: labelToDbStatus(validationStatusLabel), last_validation_date: new Date().toISOString().slice(0, 10) })
    .eq("farmer_id", farmerId);
  if (error) throw error;
}

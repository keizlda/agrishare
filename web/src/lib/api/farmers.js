import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";
import { friendlyError } from "../friendlyError.js";
import { PLACE } from "../place.js";

// Official RSBSA Enrollment Form (Revised 01-2024) format:
// RR-PP-MM-BBB-NNNNNN. Exported so the form's live mask, its submit-time
// validation, and the Farmers table's "invalid format" badge all check the
// exact same pattern.
export const RSBSA_PATTERN = /^\d{2}-\d{2}-\d{2}-\d{3}-\d{6}$/;
export function isValidRsbsaFormat(rsbsaNo) {
  return RSBSA_PATTERN.test((rsbsaNo ?? "").trim());
}

const SELECT = `
  farmer_id, profile_id, deleted_at, rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no,
  household_head, household_members, org_affiliation, association_id, status, created_at,
  profiles!profile_id ( avatar_url, role ),
  addresses ( street, sitio_id, barangay, barangay_id, municipality, province ),
  farm_parcels ( farm_location, sitio_id, farm_size_hectares, ownership_type, is_pcic_insured, livestock_details, crops ( crop_type, crop_type_id ) ),
  farmer_types ( id, name, sort_order )
`;

// A farmer's types of farmer, in the list's order: [{ id, name }].
export function typesOf(row) {
  return [...(row.farmer_types ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name }));
}

// manage-farmer-account (Edge Function): creates/updates/resets/disables a
// farmer's mobile login. Runs with the service role key server-side — never
// callable directly with the anon key's privileges from here beyond invoke.
async function invokeAccountFn(action, payload = {}) {
  const invoke = () => supabase.functions.invoke("manage-farmer-account", { body: { action, ...payload } });
  let { data, error } = await invoke();
  // A stale access token (tab left open, laptop asleep) is refused even
  // though a page refresh would work — refresh the session and retry once.
  const status = error?.context?.status;
  if (error && (status === 401 || status === 403)) {
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr) ({ data, error } = await invoke());
  }
  if (error) {
    // The function's own explanation ("Login ID … is already used by …")
    // is written for the user; anything else (no connection, a crash) is
    // passed on as-is for friendlyError to translate.
    let message = null;
    try {
      const body = await error.context?.json();
      if (body?.error) message = body.error;
    } catch {
      // no JSON body
    }
    if (message) throw new Error(message);
    throw error;
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
    deletedAt: row.deleted_at ?? null,
    rsbsaNo: row.rsbsa_no,
    rsbsaValid: isValidRsbsaFormat(row.rsbsa_no),
    avatarUrl: row.profiles?.avatar_url ?? null,
    // Made the barangay's Farmers' Association President: same login, now
    // only a president (not tagged in distributions by type).
    isFaPresident: row.profiles?.role === "fa_president",
    firstName: row.first_name,
    middleName: row.middle_name ?? "",
    lastName: row.surname,
    sex: row.sex === "male" ? "Male" : "Female",
    birthDate: row.birth_date,
    contactNo: row.contact_no ?? "",
    // Sitio/purok, farm location, association and crop: the list entry
    // (id) and its name. Records saved before the lists may have text with
    // no id; the form matches it to the list by name.
    sitioPurok: address?.street ?? "",
    sitioId: address?.sitio_id ?? null,
    barangay: address?.barangay ?? "",
    barangayId: address?.barangay_id ?? null,
    municipality: address?.municipality ?? PLACE.municipality,
    province: address?.province ?? PLACE.province,
    householdHead: row.household_head ? "Yes" : "No",
    householdMembers: row.household_members ?? "",
    // Types of farmer (one or more): what the farmer is classified as,
    // e.g. Rice farmer and Livestock farmer. They replace the single crop
    // and the seed program (kept in the database, no longer shown).
    types: typesOf(row),
    commodity: parcel?.crops?.[0]?.crop_type ?? "",
    farmSize: parcel?.farm_size_hectares != null ? Number(parcel.farm_size_hectares) : 0,
    farmLocation: parcel?.farm_location ?? "",
    farmSitioId: parcel?.sitio_id ?? null,
    ownershipType: parcel?.ownership_type ?? "",
    pcicInsured: pcicLabel(parcel?.is_pcic_insured),
    livestockDetails: parcel?.livestock_details ?? "",
    orgAffiliation: row.org_affiliation ?? "",
    associationId: row.association_id ?? null,
    status: dbStatusToLabel(row.status),
    dateRegistered: row.created_at?.slice(0, 10),
  };
}

export async function listFarmers() {
  const { data, error } = await supabase.from("farmers").select(SELECT).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapFarmer);
}

// ---------------------------------------------------------------------------
// Farmer Profile ("View" drawer) extras. The drawer's fields come straight
// from the listFarmers() row (the same object the Add/Edit form is filled
// from), so this only adds what that row lacks: the header's name suffix and
// the linked mobile account's photo + default-password flag (staff can read
// profiles; the password itself is never stored anywhere readable).
// ---------------------------------------------------------------------------
export async function getFarmerProfileExtras(farmerId) {
  const { data, error } = await supabase
    .from("farmers")
    .select("profile_id, extension_name, profiles!profile_id ( avatar_url, must_change_password )")
    .eq("farmer_id", farmerId)
    .single();
  if (error) throw error;
  return {
    extensionName: data.extension_name ?? "",
    avatarUrl: data.profiles?.avatar_url ?? null,
    hasMobileAccount: !!data.profile_id,
    // null when there's no linked account to ask about.
    usingDefaultPassword: data.profile_id ? (data.profiles?.must_change_password ?? null) : null,
  };
}

// Duplicate-check helper: a deleted farmer's RSBSA number is free to be
// reused going forward, but re-registering the exact same person is still
// worth a heads-up, so this is checked separately from the (active-only)
// in-memory duplicate check the form already does against listFarmers().
export async function findDeletedFarmerByRsbsa(rsbsaNo) {
  const { data, error } = await supabase
    .from("farmers")
    .select("farmer_id, first_name, surname")
    .eq("rsbsa_no", rsbsaNo)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.farmer_id, firstName: data.first_name, lastName: data.surname } : null;
}

// What save_farmer (database function) takes: the farmer, address, first
// farm parcel and its crop, written in one transaction. Sitio/purok, farm
// location, association, crop and barangay are list ids; the database
// writes their names and the fixed municipality and province. An older farm
// location or association that isn't on a list is sent back unchanged so
// it's kept.
const idOrNull = (v) => (v === "" || v == null ? null : /^\d+$/.test(String(v)) ? Number(v) : v);
function toSavePayload(form) {
  return {
    rsbsa_no: form.rsbsaNo,
    first_name: form.firstName,
    middle_name: form.middleName || null,
    surname: form.lastName,
    sex: form.sex ? form.sex.toLowerCase() : null,
    birth_date: form.birthDate,
    contact_no: form.contactNo,
    association_id: idOrNull(form.associationId),
    org_affiliation: form.associationId ? null : form.orgLegacy || null,
    // A new farmer is always saved Active; the status is changed in Edit.
    status: form.status ? labelToDbStatus(form.status) : null,
    sitio_id: idOrNull(form.sitioId),
    barangay_id: idOrNull(form.barangayId),
    farm_sitio_id: idOrNull(form.farmSitioId),
    farm_location: form.farmSitioId ? null : form.farmLocationLegacy || null,
    farm_size_hectares: Number(form.farmSize) || 0,
    ownership_type: form.ownershipType || null,
    is_pcic_insured: pcicDbValue(form.pcicInsured),
    farmer_type_ids: (form.typeIds ?? []).map(Number),
  };
}

async function readFarmer(farmerId) {
  const { data, error } = await supabase.from("farmers").select(SELECT).eq("farmer_id", farmerId).single();
  if (error) throw error;
  return mapFarmer(data);
}

export async function createFarmer(form) {
  const { data: farmerId, error } = await supabase.rpc("save_farmer", { p_farmer_id: null, p_farmer: toSavePayload(form) });
  if (error) throw error;

  // Account creation (manage-farmer-account) happens only once the farmer
  // record itself is fully written. If it fails (e.g. the last-6-digit login
  // ID is already taken), the new farmer record (and its cascaded
  // address/parcel/crop rows) is removed again rather than left without an
  // account. An out-of-format RSBSA (pre-existing records being corrected
  // later) just skips account creation for now — updateFarmer creates the
  // account the moment the number becomes valid.
  let account = null;
  if (isValidRsbsaFormat(form.rsbsaNo)) {
    try {
      account = await invokeAccountFn("create", {
        farmerId,
        rsbsaNo: form.rsbsaNo,
        fullName: `${form.firstName} ${form.lastName}`,
        contactNo: form.contactNo,
      });
    } catch (err) {
      await supabase.from("farmers").delete().eq("farmer_id", farmerId);
      throw err;
    }
  }

  let saved;
  try {
    saved = await readFarmer(farmerId);
  } catch {
    // Saved, but the fresh copy couldn't be read back (connection dropped):
    // show what was entered rather than an error that invites a re-save.
    saved = { ...form, id: farmerId, profileId: account?.profileId ?? null, rsbsaValid: isValidRsbsaFormat(form.rsbsaNo) };
  }
  return { ...saved, loginId: account?.loginId ?? null, tempPassword: account?.password ?? null };
}

export async function updateFarmer(farmerId, form) {
  const { data: previous, error: prevErr } = await supabase
    .from("farmers")
    .select("rsbsa_no, profile_id")
    .eq("farmer_id", farmerId)
    .single();
  if (prevErr) throw prevErr;

  const { error } = await supabase.rpc("save_farmer", { p_farmer_id: farmerId, p_farmer: toSavePayload(form) });
  if (error) throw error;

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
      accountNotice = { type: "error", message: friendlyError(err, "Please try again from the farmer's ⋯ menu.") };
    }
  }

  let saved;
  try {
    saved = await readFarmer(farmerId);
  } catch {
    saved = { ...form, id: farmerId, profileId: previous.profile_id, rsbsaValid: isValidRsbsaFormat(form.rsbsaNo) };
  }
  return { ...saved, accountNotice };
}

// Soft delete: marks the farmer removed and disables their mobile login,
// both in one server-side call (manage-farmer-account) — the row itself is
// never actually deleted, since distribution_claims/requests/crop_validations
// all reference farmer_id with no cascade (distribution history must
// survive). See findDeletedFarmerByRsbsa for the "already exists, but
// deleted" duplicate check on re-registration.
export async function deleteFarmer(farmerId) {
  return invokeAccountFn("delete", { farmerId });
}

export async function setFarmerStatus(farmerId, statusLabel) {
  const { error } = await supabase.from("farmers").update({ status: labelToDbStatus(statusLabel) }).eq("farmer_id", farmerId);
  if (error) throw error;
}

// Debounced typeahead for the beneficiary-tagging field (Distributions).
// Matches on name or RSBSA number; deliberately not the full listFarmers()
// select — this only needs to render a compact suggestion row.
const SEARCH_SELECT =
  "farmer_id, rsbsa_no, first_name, surname, status, addresses ( barangay, street ), farm_parcels ( parcel_id, farm_size_hectares, crops ( crop_type ) ), profiles!profile_id ( avatar_url ), farmer_types ( id, name, sort_order )";

// A farmer's total farm size (every parcel) and main crop (first parcel's
// first crop) — what the Distribution form and the FA President's "Add
// Farmer Request" fill in when a farmer is picked.
export function farmSummary(parcels) {
  const list = [...(parcels ?? [])].sort((a, b) => (a.parcel_id ?? 0) - (b.parcel_id ?? 0));
  const farmSize = Math.round(list.reduce((sum, p) => sum + (Number(p.farm_size_hectares) || 0), 0) * 100) / 100;
  const cropType = list.flatMap((p) => p.crops ?? []).map((c) => c.crop_type).find(Boolean) ?? "";
  return { farmSize, cropType };
}

function mapFarmerBrief(row) {
  const address = row.addresses?.[0];
  return {
    id: row.farmer_id,
    rsbsaNo: row.rsbsa_no,
    firstName: row.first_name,
    lastName: row.surname,
    barangay: address?.barangay ?? "",
    sitioPurok: address?.street ?? "",
    status: dbStatusToLabel(row.status),
    avatarUrl: row.profiles?.avatar_url ?? null,
    types: typesOf(row),
    ...farmSummary(row.farm_parcels),
  };
}

export async function searchFarmers(query, limit = 8) {
  const q = query.trim();
  if (!q) return [];
  // A query typed as bare digits (with or without hyphens the admin may
  // have included) also matches rsbsa_digits, so "097312021000143" and
  // "09-73-12-021-000143" both find the same farmer as "09-73-12-021-000143".
  const digitsOnly = q.replace(/\D/g, "");
  // Typed text goes in as a quoted filter value, so commas and brackets
  // can't break the filter, and % and _ are matched as typed (not as
  // "anything" wildcards).
  const quoted = (text) => `"%${text.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/["\\]/g, (c) => `\\${c}`)}%"`;
  const contains = quoted(q);
  const orClauses = [`first_name.ilike.${contains}`, `surname.ilike.${contains}`, `rsbsa_no.ilike.${contains}`];
  // A full name ("Rodel Bagas", "Bagas Rodel", "Rodel S. Bagas") never
  // matches one name column on its own: each word must match the first,
  // middle or last name.
  const words = q.split(/\s+/).map((w) => w.replace(/\.+$/, "")).filter(Boolean);
  if (words.length > 1) {
    const perWord = words.map((w) => `or(first_name.ilike.${quoted(w)},middle_name.ilike.${quoted(w)},surname.ilike.${quoted(w)})`);
    orClauses.push(`and(${perWord.join(",")})`);
  }
  if (digitsOnly) orClauses.push(`rsbsa_digits.ilike.%${digitsOnly}%`);
  const { data, error } = await supabase.from("farmers").select(SEARCH_SELECT).is("deleted_at", null).or(orClauses.join(",")).limit(limit);
  if (error) throw error;
  // Six digits is a login ID (the last 6 of the RSBSA number): that farmer
  // first, even when the digits also appear inside other RSBSA numbers.
  if (/^\d{6}$/.test(q)) {
    const { data: exact } = await supabase.from("farmers").select(SEARCH_SELECT).is("deleted_at", null).like("rsbsa_no", `%-${q}`).limit(1);
    const first = exact?.[0];
    if (first) return [first, ...data.filter((r) => r.farmer_id !== first.farmer_id)].slice(0, limit).map(mapFarmerBrief);
  }
  return data.map(mapFarmerBrief);
}


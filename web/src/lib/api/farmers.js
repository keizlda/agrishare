import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

const SELECT = `
  farmer_id, rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no,
  household_head, household_members, org_affiliation, status, validation_status, created_at,
  addresses ( street, barangay, municipality, province ),
  farm_parcels ( farm_location, farm_size_hectares, ownership_type, is_pcic_insured, livestock_details, crops ( crop_type ) )
`;

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
    rsbsaNo: row.rsbsa_no,
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

  return mapFarmer({
    ...farmerRow,
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
  });
}

export async function updateFarmer(farmerId, form) {
  const farmSize = Number(form.farmSize) || 0;

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

  const { data: fresh, error: fetchErr } = await supabase.from("farmers").select(SELECT).eq("farmer_id", farmerId).single();
  if (fetchErr) throw fetchErr;
  return mapFarmer(fresh);
}

export async function deleteFarmer(farmerId) {
  const { error } = await supabase.from("farmers").delete().eq("farmer_id", farmerId);
  if (error) throw error;
}

export async function setFarmerStatus(farmerId, statusLabel) {
  const { error } = await supabase.from("farmers").update({ status: labelToDbStatus(statusLabel) }).eq("farmer_id", farmerId);
  if (error) throw error;
}

export async function setFarmerValidation(farmerId, validationStatusLabel) {
  const { error } = await supabase
    .from("farmers")
    .update({ validation_status: labelToDbStatus(validationStatusLabel), last_validation_date: new Date().toISOString().slice(0, 10) })
    .eq("farmer_id", farmerId);
  if (error) throw error;
}

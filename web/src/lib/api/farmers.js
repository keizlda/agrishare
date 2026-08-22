import { supabase } from "../supabaseClient.js";
import { dbStatusToLabel, labelToDbStatus } from "../status.js";

const SELECT = `
  farmer_id, rsbsa_no, surname, first_name, sex, birth_date, contact_no, status, validation_status, created_at,
  addresses ( barangay ),
  farm_parcels ( farm_location, farm_size_hectares, crops ( crop_type ) )
`;

function mapFarmer(row) {
  const address = row.addresses?.[0];
  const parcel = row.farm_parcels?.[0];
  return {
    id: row.farmer_id,
    rsbsaNo: row.rsbsa_no,
    firstName: row.first_name,
    lastName: row.surname,
    sex: row.sex === "male" ? "Male" : "Female",
    birthDate: row.birth_date,
    contactNo: row.contact_no ?? "",
    barangay: address?.barangay ?? "Langapud",
    commodity: parcel?.crops?.[0]?.crop_type ?? "",
    farmSize: parcel?.farm_size_hectares != null ? Number(parcel.farm_size_hectares) : 0,
    farmLocation: parcel?.farm_location ?? "",
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
  const { data: farmerRow, error: farmerErr } = await supabase
    .from("farmers")
    .insert({
      rsbsa_no: form.rsbsaNo,
      surname: form.lastName,
      first_name: form.firstName,
      sex: form.sex.toLowerCase(),
      birth_date: form.birthDate,
      contact_no: form.contactNo,
      status: "active",
      validation_status: "pending",
    })
    .select("farmer_id, rsbsa_no, surname, first_name, sex, birth_date, contact_no, status, validation_status, created_at")
    .single();
  if (farmerErr) throw farmerErr;

  const { error: addrErr } = await supabase
    .from("addresses")
    .insert({ farmer_id: farmerRow.farmer_id, barangay: form.barangay });
  if (addrErr) throw addrErr;

  const farmSize = Number(form.farmSize) || 0;
  const { data: parcel, error: parcelErr } = await supabase
    .from("farm_parcels")
    .insert({ farmer_id: farmerRow.farmer_id, farm_location: form.farmLocation, farm_size_hectares: farmSize })
    .select("parcel_id")
    .single();
  if (parcelErr) throw parcelErr;

  const { error: cropErr } = await supabase
    .from("crops")
    .insert({ parcel_id: parcel.parcel_id, crop_type: form.commodity, area_planted: farmSize });
  if (cropErr) throw cropErr;

  return mapFarmer({
    ...farmerRow,
    addresses: [{ barangay: form.barangay }],
    farm_parcels: [{ farm_location: form.farmLocation, farm_size_hectares: farmSize, crops: [{ crop_type: form.commodity }] }],
  });
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

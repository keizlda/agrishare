import { supabase } from "../supabaseClient";
import { dbStatusToLabel } from "../status";

const SELECT = `
  farmer_id, profile_id, rsbsa_no, surname, first_name, contact_no, status, seed_program_id,
  seed_program:commodities!seed_program_id ( name ),
  addresses ( barangay ),
  farm_parcels ( farm_size_hectares, crops ( crop_type ) ),
  profiles!profile_id ( avatar_url, must_change_password )
`;

// Maps a farmers row (joined with address/parcel/crop) to the shape every
// mobile screen already expects from the old mock `currentFarmer` object.
function mapFarmer(row) {
  const address = row.addresses?.[0];
  const parcel = row.farm_parcels?.[0];
  return {
    farmerId: row.farmer_id,
    profileId: row.profile_id,
    firstName: row.first_name,
    lastName: row.surname,
    rsbsaNo: row.rsbsa_no,
    barangay: address?.barangay ?? "Langapud",
    contactNo: row.contact_no ?? "",
    farmSize: parcel?.farm_size_hectares != null ? `${Number(parcel.farm_size_hectares).toFixed(2)} ha` : "—",
    // Total farm size in hectares (every parcel), for suggested quantities.
    farmSizeHa: Math.round((row.farm_parcels ?? []).reduce((a, p) => a + (Number(p.farm_size_hectares) || 0), 0) * 100) / 100,
    // Seed program: the commodity the farmer is enrolled in, e.g.
    // "Rice Seeds – Inbred (RCEF)". Optional.
    seedProgramId: row.seed_program_id ?? null,
    seedProgramName: row.seed_program?.name ?? "",
    primaryCommodity: parcel?.crops?.[0]?.crop_type ?? "—",
    // A farmer's own status is only Active/Inactive — validation belongs to
    // each proof-of-planting submission (see api/cropValidation).
    status: dbStatusToLabel(row.status),
    avatarUrl: row.profiles?.avatar_url ?? null,
    mustChangePassword: row.profiles?.must_change_password ?? false,
  };
}

export async function getMyFarmerProfile(authUserId) {
  const { data, error } = await supabase.from("farmers").select(SELECT).eq("profile_id", authUserId).single();
  if (error) throw error;
  return mapFarmer(data);
}

import { supabase } from "../supabaseClient.js";

const SELECT = `
  validation_id, farmer_id, photo_url, latitude, longitude, gps_accuracy_meters,
  captured_at, status, remarks, reviewed_by, reviewed_at, created_at,
  farmers (
    farmer_id, rsbsa_no, surname, first_name, sex, birth_date, contact_no, status,
    addresses ( street, barangay, municipality, province ),
    farm_parcels ( farm_location, farm_size_hectares, ownership_type, crops ( crop_type ) )
  ),
  reviewer:profiles!reviewed_by ( full_name )
`;

const STATUS_LABELS = { pending: "Pending", validated: "Validated", rejected: "Rejected" };

function mapSubmission(row) {
  const farmer = row.farmers;
  const address = farmer?.addresses?.[0];
  const parcel = farmer?.farm_parcels?.[0];
  return {
    id: row.validation_id,
    farmerId: row.farmer_id,
    photoPath: row.photo_url,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    gpsAccuracyMeters: row.gps_accuracy_meters != null ? Number(row.gps_accuracy_meters) : null,
    capturedAt: row.captured_at,
    submittedAt: row.created_at,
    status: STATUS_LABELS[row.status] ?? row.status,
    remarks: row.remarks ?? "",
    reviewedBy: row.reviewer?.full_name ?? null,
    reviewedAt: row.reviewed_at,
    farmer: farmer
      ? {
          id: farmer.farmer_id,
          rsbsaNo: farmer.rsbsa_no,
          firstName: farmer.first_name,
          lastName: farmer.surname,
          fullName: `${farmer.first_name} ${farmer.surname}`,
          sex: farmer.sex === "male" ? "Male" : "Female",
          birthDate: farmer.birth_date,
          contactNo: farmer.contact_no ?? "",
          address: [address?.street, address?.barangay, address?.municipality, address?.province].filter(Boolean).join(", "),
          barangay: address?.barangay ?? "Langapud",
          commodity: parcel?.crops?.[0]?.crop_type ?? "",
          farmSize: parcel?.farm_size_hectares != null ? Number(parcel.farm_size_hectares) : null,
          farmLocation: parcel?.farm_location ?? "",
          status: farmer.status === "active" ? "Active" : "Inactive",
        }
      : null,
  };
}

export async function listSubmissions() {
  const { data, error } = await supabase.from("crop_validations").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapSubmission);
}

// photo_url is a private Storage object path (e.g. "12/1735600000000.jpg"),
// not a public URL — the bucket is private (RLS-gated to the owning farmer
// + staff), so every render needs a fresh short-lived signed URL.
export async function getSignedPhotoUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("crop-validation-photos").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

async function reviewSubmission(validationId, status, remarks) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("crop_validations")
    .update({
      status,
      remarks: remarks || null,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("validation_id", validationId);
  if (error) throw error;

  const { data: fresh, error: fetchErr } = await supabase.from("crop_validations").select(SELECT).eq("validation_id", validationId).single();
  if (fetchErr) throw fetchErr;
  return mapSubmission(fresh);
}

export function validateSubmission(validationId, remarks) {
  return reviewSubmission(validationId, "validated", remarks);
}

export function rejectSubmission(validationId, remarks) {
  return reviewSubmission(validationId, "rejected", remarks);
}

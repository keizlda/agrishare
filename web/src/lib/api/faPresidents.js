import { supabase } from "../supabaseClient.js";

// Farmers' Association President accounts (Settings, MAO Admin). Each one
// belongs to one barangay and only sees that barangay's records; a barangay
// has one president (the database sends the previous one back to being a
// farmer). A president made from a farmer signs in with their login ID.
const mapFa = (r) => ({
  id: r.id,
  name: r.full_name,
  email: r.email,
  contactNo: r.contact_no ?? "",
  barangayId: r.barangay_id,
  createdAt: r.created_at,
  loginId: r.login_id ?? null,
  farmerId: r.farmer_id ?? null,
});

export async function listFaPresidents() {
  const { data, error } = await supabase.rpc("list_fa_presidents");
  if (error) throw error;
  return (data ?? []).map(mapFa);
}

// MAO Admin: make a farmer (with a login) the president of their barangay.
// Returns { name, barangay, loginId, replaced }.
export async function promoteFarmer(farmerId) {
  const { data, error } = await supabase.rpc("promote_farmer_to_fa_president", { p_farmer_id: farmerId });
  if (error) throw error;
  return { name: data.name, barangay: data.barangay, loginId: data.login_id, replaced: data.replaced ?? "" };
}

export async function setFaPresidentBarangay(userId, barangayId) {
  const { error } = await supabase.rpc("set_fa_president_barangay", { p_user: userId, p_barangay: Number(barangayId) });
  if (error) throw error;
}

async function callAccountFn(body) {
  const { data, error } = await supabase.functions.invoke("manage-fa-account", { body });
  if (error) {
    // The function's own message (e.g. "An account with this email already exists.").
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Returns { userId, email, password }: the temporary password is shown once.
export const createFaPresident = ({ fullName, email, contactNo, barangayId }) => callAccountFn({ action: "create", fullName, email, contactNo, barangayId: Number(barangayId) });
export const resetFaPresidentPassword = (userId) => callAccountFn({ action: "reset-password", userId });

import { supabase } from "../supabaseClient.js";

// Farmers' Association President accounts (Settings, MAO Admin). Each one
// belongs to one barangay and only sees that barangay's records.
const mapFa = (r) => ({ id: r.id, name: r.full_name, email: r.email, contactNo: r.contact_no ?? "", barangayId: r.barangay_id, createdAt: r.created_at });

export async function listFaPresidents() {
  const { data, error } = await supabase.rpc("list_fa_presidents");
  if (error) throw error;
  return (data ?? []).map(mapFa);
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

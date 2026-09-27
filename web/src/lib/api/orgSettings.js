import { supabase } from "../supabaseClient.js";

const SELECT = "lgu_name, system_name, address, contact_number, email, fiscal_year";

function mapSettings(row) {
  return {
    lguName: row.lgu_name,
    systemName: row.system_name,
    address: row.address,
    contactNumber: row.contact_number,
    email: row.email,
    fiscalYear: row.fiscal_year,
  };
}

// Single row (id = true) — see the migration.
export async function getOrgSettings() {
  const { data, error } = await supabase.from("org_settings").select(SELECT).eq("id", true).single();
  if (error) throw error;
  return mapSettings(data);
}

// RLS ("org_settings: MAO writes") restricts this to mao_admin.
export async function updateOrgSettings(fields) {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("org_settings")
    .update({
      lgu_name: fields.lguName,
      system_name: fields.systemName,
      address: fields.address,
      contact_number: fields.contactNumber,
      email: fields.email,
      fiscal_year: fields.fiscalYear,
      updated_by: auth?.user?.id ?? null,
    })
    .eq("id", true)
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapSettings(data);
}

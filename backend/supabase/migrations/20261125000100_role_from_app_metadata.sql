-- Roles from app_metadata, also when it's set after the account is created
-- (Nov 25, 2026).
--
-- Supabase's admin API (used by the account functions and the seed) creates
-- the user first and writes app_metadata in a second step, so the new-user
-- trigger sees no role yet and the profile starts as a farmer. When the
-- server then sets app_metadata.role (only the server can), the profile
-- follows: its role, and for a Farmers' Association President the barangay
-- in app_metadata — only when the profile has none yet, so a barangay the
-- MAO Admin assigns later in Settings is never undone.

create or replace function public.sync_profile_from_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_brgy bigint;
begin
  if nullif(new.raw_app_meta_data ->> 'role', '') is null then
    return new;
  end if;
  v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  if v_role = 'fa_president' then
    select id into v_brgy from public.barangays
    where id::text = nullif(new.raw_app_meta_data ->> 'barangay_id', '') and is_active;
  end if;
  update public.profiles
  set role = v_role,
      barangay_id = case when v_role = 'fa_president' and barangay_id is null then v_brgy else barangay_id end
  where id = new.id
    and (role is distinct from v_role or (v_role = 'fa_president' and barangay_id is null));
  return new;
end;
$$;

drop trigger if exists on_auth_user_app_metadata on auth.users;
create trigger on_auth_user_app_metadata
  after update of raw_app_meta_data on auth.users
  for each row
  when (new.raw_app_meta_data is distinct from old.raw_app_meta_data)
  execute function public.sync_profile_from_app_metadata();

-- Farmers' Association Presidents have their own accounts (Nov 28, 2026).
--
-- Each barangay's president signs in with an account of their own
-- (fapresident@<barangay>.gov.ph), made in Settings → Farmers' Association
-- Presidents; a farmer is no longer made a president from the Farmers page.
-- The MAO Admin can now change an account's name and mobile number (the
-- accounts are first made as "FA President – <barangay>").

-- A farmer can no longer be made the president.
revoke execute on function public.promote_farmer_to_fa_president(bigint) from anon, public, authenticated;

-- MAO Admin: a president's name and mobile number.
create or replace function public.update_fa_president_details(p_user uuid, p_full_name text, p_contact_no text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old record;
  v_name text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_contact text := nullif(regexp_replace(coalesce(p_contact_no, ''), '\s', '', 'g'), '');
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can change a Farmers'' Association President''s details.';
  end if;
  if v_name = '' then
    raise exception 'Enter the full name.';
  end if;
  if length(v_name) > 120 then
    raise exception 'Keep the name to 120 characters.';
  end if;
  if v_contact is not null and v_contact !~ '^09\d{9}$' then
    raise exception 'Enter an 11-digit mobile number starting with 09.';
  end if;
  select full_name, contact_no, barangay_id into v_old from public.profiles where id = p_user and role = 'fa_president';
  if not found then
    raise exception 'That Farmers'' Association President account wasn''t found.';
  end if;
  if v_old.full_name is not distinct from v_name and v_old.contact_no is not distinct from v_contact then
    return;
  end if;

  update public.profiles set full_name = v_name, contact_no = v_contact where id = p_user;
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_name, 'contact_no', v_contact)
  where id = p_user;
  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details, barangay_id)
  values (auth.uid(), 'mao_admin', 'profiles', 'update', p_user::text,
          'Farmers'' Association President details changed: ' || v_name,
          jsonb_build_object('old', jsonb_build_object('full_name', v_old.full_name, 'contact_no', v_old.contact_no),
                             'new', jsonb_build_object('full_name', v_name, 'contact_no', v_contact)),
          jsonb_build_object('id', p_user), v_old.barangay_id);
end;
$function$;
revoke execute on function public.update_fa_president_details(uuid, text, text) from anon, public;
grant execute on function public.update_fa_president_details(uuid, text, text) to authenticated;

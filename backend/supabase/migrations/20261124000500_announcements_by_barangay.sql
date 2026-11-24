-- Announcements by barangay (Nov 24, 2026). AgriShare now covers every
-- barangay of Labangan.
--
--   * New list public.barangays (id, name, is_active), managed like the
--     other lists (Settings → Lists): the MAO Admin adds, renames and
--     deactivates (no deletes). It starts with the 25 barangays of
--     Labangan; Langapud keeps the spelling the system already uses.
--   * Farmers belong to the barangay of their address
--     (addresses.barangay_id; the text column always shows its name) and a
--     Farmers' Association President to the barangay on their profile
--     (profiles.barangay_id). Existing records are linked to Langapud,
--     except the three records the team keeps unchanged (Maui Pelaez,
--     Claude Oclarit, Luna Cuizon), which are matched by their barangay text.
--   * A post has a title (required, up to 150 characters), an optional date,
--     time and venue (the old distribution_date, distribution_time and venue
--     columns), optional details (body, up to 2,000 characters), a photo
--     and a pin. Who can see it: farmers, Farmers' Association Presidents
--     or both (audience), in all barangays or in chosen ones
--     (all_barangays, barangay_ids). The database enforces it: a farmer or
--     Farmers' Association President reads only posts meant for them in
--     their barangay (or all barangays); the MAO Admin reads all.
--   * Existing posts were made when the system covered Langapud only, so
--     they're linked to Langapud (nobody's view changes). Their text, which
--     the posts update had combined, is split back: the title stays the
--     title, date/time and venue come from their own columns again, and the
--     details are the original text (type of assistance and requirements,
--     which have no field of their own now, stay in the details). Posts
--     saved by the web in between (title, details, then only the date /
--     time and venue lines) are split the same way. A post whose text
--     doesn't have the expected shape is left as it is. The audit log keeps
--     every post's text from before this change.
--   * Notifications go only to the people who can see the post.

-- ------------------------------------------------------------- barangays
create table public.barangays (
  id bigint generated always as identity primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid()
);
create unique index barangays_name_key on public.barangays (public.list_name_key(name));
create trigger clean_list_name before insert or update of name on public.barangays for each row execute function public.clean_list_name();

insert into public.barangays (name) values
  ('Bagalupa'), ('Balimbingan'), ('Binayan'), ('Bokong'), ('Bulanit'),
  ('Cogonan'), ('Combo'), ('Dalapang'), ('Dimasangca'), ('Dipaya'),
  ('Langapud'), ('Lantian'), ('Lower Campo Islam'), ('Lower Pulacan'), ('Lower Sang-an'),
  ('New Labangan'), ('Noboran'), ('Old Labangan'), ('San Isidro'), ('Santa Cruz'),
  ('Tapodoc'), ('Tawagan Norte'), ('Upper Campo Islam'), ('Upper Pulacan'), ('Upper Sang-an');

alter table public.barangays enable row level security;
create policy "barangays: signed-in users read" on public.barangays for select to authenticated using (true);
create policy "barangays: MAO adds" on public.barangays for insert to authenticated
  with check (public.current_role() = 'mao_admin' and is_active);
create policy "barangays: MAO edits" on public.barangays for update to authenticated
  using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');
revoke all on public.barangays from anon, authenticated;
grant select, insert, update on public.barangays to authenticated;

-- ------------------------------------------------ who belongs where
alter table public.addresses add column barangay_id bigint references public.barangays (id);
alter table public.profiles add column barangay_id bigint references public.barangays (id);

update public.addresses a set barangay_id = b.id
from public.barangays b
where public.list_name_key(b.name) = public.list_name_key(a.barangay)
  and a.farmer_id not in (select farmer_id from public.farmers where rsbsa_no in ('09-73-00-000-000537', '09-73-00-000-000612', '09-73-00-000-000389'));

update public.profiles set barangay_id = (select id from public.barangays where name = 'Langapud')
where role = 'fa_president' and barangay_id is null;

-- The address text always shows the barangay's name; an address saved with
-- only the text (older code) is linked when the text matches a barangay.
create or replace function public.address_barangay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_name text;
begin
  if new.barangay_id is not null then
    if TG_OP = 'INSERT' or new.barangay_id is distinct from old.barangay_id then
      select name into v_name from public.barangays where id = new.barangay_id;
      new.barangay := coalesce(v_name, new.barangay);
    end if;
  elsif TG_OP = 'INSERT' then
    select id, name into v_id, v_name from public.barangays where public.list_name_key(name) = public.list_name_key(new.barangay) limit 1;
    if v_id is not null then
      new.barangay_id := v_id;
      new.barangay := v_name;
    end if;
  end if;
  return new;
end;
$$;
create trigger address_barangay before insert or update of barangay_id on public.addresses for each row execute function public.address_barangay();

-- Renaming a list entry renames it on the linked records.
create or replace function public.rename_list_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_TABLE_NAME = 'sitios' then
    update public.addresses set street = new.name where sitio_id = new.id;
    update public.farm_parcels set farm_location = new.name where sitio_id = new.id;
  elsif TG_TABLE_NAME = 'associations' then
    update public.farmers set org_affiliation = new.name where association_id = new.id;
  elsif TG_TABLE_NAME = 'crop_types' then
    update public.crops set crop_type = new.name where crop_type_id = new.id;
  elsif TG_TABLE_NAME = 'barangays' then
    update public.addresses set barangay = new.name where barangay_id = new.id;
  end if;
  return new;
end;
$$;
create trigger rename_list_entry after update of name on public.barangays for each row when (old.name is distinct from new.name) execute function public.rename_list_entry();

-- A user's barangay: a farmer's from their address (linked, or its text),
-- a Farmers' Association President's from their profile.
create or replace function public.user_barangay_id(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case (select role from public.profiles where id = p_user)
    when 'farmer' then (
      select coalesce(a.barangay_id, (select b.id from public.barangays b where public.list_name_key(b.name) = public.list_name_key(a.barangay) limit 1))
      from public.farmers f join public.addresses a on a.farmer_id = f.farmer_id
      where f.profile_id = p_user and f.deleted_at is null
      order by a.address_id
      limit 1)
    when 'fa_president' then (select barangay_id from public.profiles where id = p_user)
  end
$$;
revoke execute on function public.user_barangay_id(uuid) from anon, authenticated, public;

create or replace function public.my_barangay_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$ select public.user_barangay_id(auth.uid()) $$;
revoke execute on function public.my_barangay_id() from anon, public;
grant execute on function public.my_barangay_id() to authenticated;

-- ------------------------------------------------------- the farmer form
-- save_farmer takes the barangay from the list (required); municipality
-- and province stay Labangan, Zamboanga del Sur. Older code that doesn't
-- send a barangay keeps the farmer's current one (Langapud for a new one).
create or replace function public.save_farmer(p_farmer_id bigint, p_farmer jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  v_parcel bigint;
  v_birth date;
  v_size numeric;
  v_program bigint := nullif(p_farmer ->> 'seed_program_id', '')::bigint;
  v_sitio bigint := nullif(p_farmer ->> 'sitio_id', '')::bigint;
  v_farm_sitio bigint := nullif(p_farmer ->> 'farm_sitio_id', '')::bigint;
  v_assoc bigint := nullif(p_farmer ->> 'association_id', '')::bigint;
  v_crop bigint := nullif(p_farmer ->> 'crop_type_id', '')::bigint;
  v_brgy bigint := nullif(p_farmer ->> 'barangay_id', '')::bigint;
  v_sex text := nullif(p_farmer ->> 'sex', '');
  v_status text := nullif(p_farmer ->> 'status', '');
  v_ownership text := nullif(btrim(coalesce(p_farmer ->> 'ownership_type', '')), '');
  -- What the farmer has now (edits): a deactivated entry may be kept.
  v_cur_sitio bigint;
  v_cur_farm_sitio bigint;
  v_cur_farm_location text;
  v_cur_assoc bigint;
  v_cur_org text;
  v_cur_crop bigint;
  v_cur_brgy bigint;
  v_street text;
  v_farm_location text;
  v_org text;
  v_crop_name text;
  v_brgy_name text;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can register or edit farmers.';
  end if;
  if btrim(coalesce(p_farmer ->> 'first_name', '')) = '' or btrim(coalesce(p_farmer ->> 'surname', '')) = '' then
    raise exception 'First name and last name are required.';
  end if;
  if v_sex is null or v_sex not in ('male', 'female') then
    raise exception 'Choose the sex.';
  end if;
  v_birth := nullif(p_farmer ->> 'birth_date', '')::date;
  if v_birth is null or v_birth > current_date then
    raise exception 'Enter a realistic birth date — not in the future.';
  end if;
  v_size := nullif(p_farmer ->> 'farm_size_hectares', '')::numeric;
  if v_size is null or v_size <= 0 then
    raise exception 'Farm size must be greater than 0.';
  end if;
  if v_status is null or v_status not in ('active', 'inactive') then
    raise exception 'Choose a status (Active or Inactive).';
  end if;
  if v_ownership is null then
    raise exception 'Choose the ownership / tenurial status.';
  end if;
  if v_program is not null and not exists (
    select 1 from public.commodities c
    where c.commodity_id = v_program and c.deleted_at is null and c.allocation_per_hectare is not null
      and (p_farmer_id is not null and v_program = (select seed_program_id from public.farmers where farmer_id = p_farmer_id) or c.status = 'active')
  ) then
    raise exception 'Choose a seed program from the list (commodities with a kg-per-hectare allocation).';
  end if;

  if p_farmer_id is not null then
    select f.association_id, f.org_affiliation into v_cur_assoc, v_cur_org
    from public.farmers f where f.farmer_id = p_farmer_id and f.deleted_at is null;
    select a.sitio_id, coalesce(a.barangay_id, (select b.id from public.barangays b where public.list_name_key(b.name) = public.list_name_key(a.barangay) limit 1))
      into v_cur_sitio, v_cur_brgy
    from public.addresses a where a.farmer_id = p_farmer_id order by a.address_id limit 1;
    select p.parcel_id, p.sitio_id, p.farm_location into v_parcel, v_cur_farm_sitio, v_cur_farm_location
    from public.farm_parcels p where p.farmer_id = p_farmer_id order by p.parcel_no, p.parcel_id limit 1;
    select c.crop_type_id into v_cur_crop from public.crops c where c.parcel_id = v_parcel order by c.crop_id limit 1;
    v_parcel := null;
  end if;

  -- Barangay (required): from the list.
  if not (p_farmer ? 'barangay_id') then
    v_brgy := coalesce(v_cur_brgy, (select id from public.barangays where name = 'Langapud'));
  end if;
  if v_brgy is not null then
    select name into v_brgy_name from public.barangays where id = v_brgy and (is_active or id = v_cur_brgy);
  end if;
  if v_brgy_name is null then
    raise exception 'Choose the barangay from the list.';
  end if;

  -- Sitio / Purok (required) and commodity/crop (required): from the lists.
  if v_sitio is not null then
    select name into v_street from public.sitios where id = v_sitio and (is_active or id = v_cur_sitio);
  end if;
  if v_street is null then
    raise exception 'Choose the sitio/purok from the list.';
  end if;
  if v_crop is not null then
    select name into v_crop_name from public.crop_types where id = v_crop and (is_active or id = v_cur_crop);
  end if;
  if v_crop_name is null then
    raise exception 'Choose the commodity/crop from the list.';
  end if;
  -- Farm location (optional): a sitio/purok from the list, or an older
  -- entry that isn't on the list, kept exactly as it was.
  if v_farm_sitio is not null then
    select name into v_farm_location from public.sitios where id = v_farm_sitio and (is_active or id = v_cur_farm_sitio);
    if v_farm_location is null then
      raise exception 'Choose the farm location from the sitio/purok list.';
    end if;
  elsif v_cur_farm_sitio is null and v_cur_farm_location is not null
        and btrim(coalesce(p_farmer ->> 'farm_location', '')) = v_cur_farm_location then
    v_farm_location := v_cur_farm_location;
  end if;
  -- Farmers' association (optional): from the list, or an older entry kept
  -- as it was.
  if v_assoc is not null then
    select name into v_org from public.associations where id = v_assoc and (is_active or id = v_cur_assoc);
    if v_org is null then
      raise exception 'Choose the farmers'' association from the list.';
    end if;
  elsif v_cur_assoc is null and v_cur_org is not null
        and btrim(coalesce(p_farmer ->> 'org_affiliation', '')) = v_cur_org then
    v_org := v_cur_org;
  end if;

  if p_farmer_id is null then
    insert into public.farmers (
      rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no, org_affiliation, association_id, status, seed_program_id
    ) values (
      btrim(p_farmer ->> 'rsbsa_no'), btrim(p_farmer ->> 'surname'), btrim(p_farmer ->> 'first_name'),
      nullif(btrim(p_farmer ->> 'middle_name'), ''), v_sex::public.sex_type, v_birth,
      p_farmer ->> 'contact_no', v_org, v_assoc, v_status::public.farmer_status, v_program
    )
    returning farmer_id into v_id;

    insert into public.addresses (farmer_id, street, sitio_id, barangay, barangay_id, municipality, province)
    values (v_id, v_street, v_sitio, v_brgy_name, v_brgy, 'Labangan', 'Zamboanga del Sur');

    insert into public.farm_parcels (farmer_id, farm_location, sitio_id, farm_size_hectares, ownership_type, is_pcic_insured)
    values (v_id, v_farm_location, v_farm_sitio, v_size, v_ownership, (p_farmer ->> 'is_pcic_insured')::boolean)
    returning parcel_id into v_parcel;

    insert into public.crops (parcel_id, crop_type, crop_type_id, area_planted)
    values (v_parcel, v_crop_name, v_crop, v_size);
    return v_id;
  end if;

  update public.farmers set
    rsbsa_no = btrim(p_farmer ->> 'rsbsa_no'),
    surname = btrim(p_farmer ->> 'surname'),
    first_name = btrim(p_farmer ->> 'first_name'),
    middle_name = nullif(btrim(p_farmer ->> 'middle_name'), ''),
    sex = v_sex::public.sex_type,
    birth_date = v_birth,
    contact_no = p_farmer ->> 'contact_no',
    org_affiliation = v_org,
    association_id = v_assoc,
    status = v_status::public.farmer_status,
    seed_program_id = v_program
  where farmer_id = p_farmer_id and deleted_at is null
  returning farmer_id into v_id;
  if v_id is null then
    raise exception 'That farmer record no longer exists — refresh and try again.';
  end if;

  update public.addresses set
    street = v_street,
    sitio_id = v_sitio,
    barangay = v_brgy_name,
    barangay_id = v_brgy,
    municipality = 'Labangan',
    province = 'Zamboanga del Sur'
  where farmer_id = v_id;
  if not found then
    insert into public.addresses (farmer_id, street, sitio_id, barangay, barangay_id, municipality, province)
    values (v_id, v_street, v_sitio, v_brgy_name, v_brgy, 'Labangan', 'Zamboanga del Sur');
  end if;

  select parcel_id into v_parcel from public.farm_parcels where farmer_id = v_id order by parcel_no, parcel_id limit 1;
  if v_parcel is null then
    insert into public.farm_parcels (farmer_id, farm_location, sitio_id, farm_size_hectares, ownership_type, is_pcic_insured)
    values (v_id, v_farm_location, v_farm_sitio, v_size, v_ownership, (p_farmer ->> 'is_pcic_insured')::boolean)
    returning parcel_id into v_parcel;
  else
    update public.farm_parcels set
      farm_location = v_farm_location,
      sitio_id = v_farm_sitio,
      farm_size_hectares = v_size,
      ownership_type = v_ownership,
      is_pcic_insured = (p_farmer ->> 'is_pcic_insured')::boolean
    where parcel_id = v_parcel;
  end if;

  update public.crops set crop_type = v_crop_name, crop_type_id = v_crop, area_planted = v_size
  where crop_id = (select crop_id from public.crops where parcel_id = v_parcel order by crop_id limit 1);
  if not found then
    insert into public.crops (parcel_id, crop_type, crop_type_id, area_planted) values (v_parcel, v_crop_name, v_crop, v_size);
  end if;
  return v_id;
end;
$$;

-- --------------------------------------------- list usage (Settings → Lists)
create or replace function public.list_usage()
returns table (list text, id bigint, uses bigint)
language sql
stable
security definer
set search_path = public
as $$
  select 'sitios', s.id, (
    select count(distinct u.farmer_id) from (
      select a.farmer_id from public.addresses a
        where a.sitio_id = s.id or (a.sitio_id is null and public.list_name_key(a.street) = public.list_name_key(s.name))
      union all
      select p.farmer_id from public.farm_parcels p
        where p.sitio_id = s.id or (p.sitio_id is null and public.list_name_key(p.farm_location) = public.list_name_key(s.name))
    ) u)
  from public.sitios s
  where public.is_staff()
  union all
  select 'associations', x.id, (
    select count(*) from public.farmers f
    where f.association_id = x.id or (f.association_id is null and public.list_name_key(f.org_affiliation) = public.list_name_key(x.name)))
  from public.associations x
  where public.is_staff()
  union all
  select 'crop_types', t.id, (
    select count(distinct p.farmer_id) from public.crops c join public.farm_parcels p on p.parcel_id = c.parcel_id
    where c.crop_type_id = t.id or (c.crop_type_id is null and public.list_name_key(c.crop_type) = public.list_name_key(t.name)))
  from public.crop_types t
  where public.is_staff()
  union all
  select 'barangays', b.id, (
    select count(distinct a.farmer_id) from public.addresses a join public.farmers f on f.farmer_id = a.farmer_id and f.deleted_at is null
    where a.barangay_id = b.id or (a.barangay_id is null and public.list_name_key(a.barangay) = public.list_name_key(b.name)))
  from public.barangays b
  where public.is_staff();
$$;

-- ----------------------------------------------------------------- the audit
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec_id text;
  old_data jsonb;
  new_data jsonb;
  actor_role public.user_role;
  v_summary text;
  v_farmer text;
  v_filer text;
  v_item text;
  v_label text;
begin
  old_data := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_data := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  rec_id := coalesce(
    (new_data ->> 'harvest_report_id'), (old_data ->> 'harvest_report_id'),
    (new_data ->> 'association_request_id'), (old_data ->> 'association_request_id'),
    (new_data ->> 'item_id'), (old_data ->> 'item_id'),
    (new_data ->> 'claim_id'), (old_data ->> 'claim_id'),
    (new_data ->> 'event_id'), (old_data ->> 'event_id'),
    (new_data ->> 'event_item_id'), (old_data ->> 'event_item_id'),
    (new_data ->> 'request_id'), (old_data ->> 'request_id'),
    (new_data ->> 'commodity_id'), (old_data ->> 'commodity_id'),
    (new_data ->> 'announcement_id'), (old_data ->> 'announcement_id'),
    (new_data ->> 'farmer_id'), (old_data ->> 'farmer_id'),
    (new_data ->> 'id'), (old_data ->> 'id')
  );
  select role into actor_role from public.profiles where id = auth.uid();
  v_summary := initcap(TG_OP) || ' on ' || TG_TABLE_NAME || coalesce(' (id ' || rec_id || ')', '');

  -- A new farmer request says who filed it and for whom: the farmer
  -- themselves, or the Farmers' Association President for the farmer.
  if TG_TABLE_NAME = 'requests' and TG_OP = 'INSERT' then
    select btrim(f.first_name || ' ' || f.surname) into v_farmer from public.farmers f where f.farmer_id = (new_data ->> 'farmer_id')::bigint;
    select rtrim(rtrim(to_char((new_data ->> 'quantity_requested')::numeric, 'FM999,999,990.00'), '0'), '.') || ' ' || coalesce(c.unit, '') || ' of ' || c.name
      into v_item from public.commodities c where c.commodity_id = (new_data ->> 'commodity_id')::bigint;
    if new_data ->> 'filed_by' is not null then
      select full_name into v_filer from public.profiles where id = (new_data ->> 'filed_by')::uuid;
      v_summary := 'Request filed by ' || coalesce(v_filer, 'the Farmers'' Association President') || ' (Farmers'' Association President) for '
        || coalesce(v_farmer, 'a farmer') || coalesce(': ' || v_item, '');
    else
      v_summary := 'Request submitted by ' || coalesce(v_farmer, 'a farmer') || coalesce(': ' || v_item, '');
    end if;
  end if;

  -- The managed lists: "Sitio/Purok added: Purok 6", "Farmers' association
  -- renamed: A → B", "Crop deactivated: Vegetables", "Barangay added: …".
  if TG_TABLE_NAME in ('sitios', 'associations', 'crop_types', 'barangays') then
    v_label := case TG_TABLE_NAME when 'sitios' then 'Sitio/Purok' when 'associations' then 'Farmers'' association' when 'barangays' then 'Barangay' else 'Crop' end;
    if TG_OP = 'INSERT' then
      v_summary := v_label || ' added: ' || (new_data ->> 'name');
    elsif TG_OP = 'DELETE' then
      v_summary := v_label || ' deleted: ' || (old_data ->> 'name');
    elsif (old_data ->> 'name') is distinct from (new_data ->> 'name') then
      v_summary := v_label || ' renamed: ' || (old_data ->> 'name') || ' → ' || (new_data ->> 'name');
    elsif (old_data ->> 'is_active') is distinct from (new_data ->> 'is_active') then
      v_summary := v_label || case when (new_data ->> 'is_active')::boolean then ' reactivated: ' else ' deactivated: ' end || (new_data ->> 'name');
    end if;
  end if;

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
  values (
    auth.uid(), actor_role, TG_TABLE_NAME, lower(TG_OP), rec_id,
    v_summary,
    jsonb_build_object('old', old_data, 'new', new_data),
    coalesce(new_data, old_data)
  );
  return coalesce(new, old);
end;
$$;
create trigger audit_barangays after insert or update or delete on public.barangays for each row execute function public.log_audit_event();

-- ------------------------------------------------------------ the posts
alter table public.announcements add column all_barangays boolean not null default true;
alter table public.announcements add column barangay_ids bigint[] not null default '{}';
alter table public.announcements add constraint announcements_barangays_check check (all_barangays or cardinality(barangay_ids) > 0);

-- Details are optional now (the title is required: announcements_title_check).
alter table public.announcements drop constraint announcements_body_check;
alter table public.announcements add constraint announcements_body_check check (char_length(body) <= 2000);

create or replace function public.announcements_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = now();
  end if;

  -- audience decides who sees it; the recipient booleans follow. A change
  -- to the booleans alone (a forward to farmers) updates the audience.
  if tg_op = 'UPDATE' and new.audience is not distinct from old.audience
     and (new.for_all_registered_farmers is distinct from old.for_all_registered_farmers
          or new.for_fa_president is distinct from old.for_fa_president) then
    new.audience := case
      when new.for_all_registered_farmers and new.for_fa_president then 'everyone'
      when new.for_fa_president then 'fa_president'
      else 'farmers'
    end;
  end if;
  new.for_all_registered_farmers := new.audience in ('farmers', 'everyone');
  new.for_fa_president := new.audience in ('fa_president', 'everyone');

  -- The title is its own field; older code that sends only the text gets
  -- the text's first line.
  new.body := coalesce(new.body, '');
  new.title := btrim(coalesce(new.title, ''));
  if new.title = '' then
    new.title := left(btrim(split_part(btrim(new.body), E'\n', 1)), 150);
  end if;
  new.venue := nullif(btrim(coalesce(new.venue, '')), '');

  -- Barangays: none listed for "All barangays"; otherwise at least one,
  -- each on the list (a deactivated one can't be newly chosen).
  if new.all_barangays then
    new.barangay_ids := '{}';
  else
    new.barangay_ids := array(select distinct x from unnest(coalesce(new.barangay_ids, '{}')) x where x is not null order by x);
    if cardinality(new.barangay_ids) = 0 then
      raise exception 'Choose at least one barangay.';
    end if;
    if exists (
      select 1 from unnest(new.barangay_ids) x
      left join public.barangays b on b.id = x
      where b.id is null or (not b.is_active and (tg_op = 'INSERT' or not (x = any (old.barangay_ids))))
    ) then
      raise exception 'Choose the barangays from the list.';
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------- existing posts: split back, Langapud
do $$
declare
  r record;
  v_langapud bigint := (select id from public.barangays where name = 'Langapud');
  v_title text;
  v_when text;
  v_lines text;
  v_short text;
  v_used text;
  v_rest text;
  v_keep text;
begin
  for r in select * from public.announcements order by announcement_id loop
    v_title := nullif(btrim(r.title), '');
    v_when := case
      when r.distribution_date is not null then
        'Date: ' || to_char(r.distribution_date, 'FMMonth FMDD, YYYY')
          || coalesce(' · ' || ltrim(to_char(r.distribution_time, 'HH12:MI AM'), '0'), '')
      when r.distribution_time is not null then 'Time: ' || ltrim(to_char(r.distribution_time, 'HH12:MI AM'), '0')
    end;
    -- The lines the posts update wrote under the text ...
    v_lines := nullif(concat_ws(E'\n', v_when,
      'Venue: ' || nullif(btrim(r.venue), ''),
      'Type of assistance: ' || nullif(btrim(r.assistance_type), ''),
      'Requirements: ' || nullif(btrim(r.requirements), '')
    ), '');
    -- ... or, for a post saved by the web after that (title, details, date /
    -- time / venue), only the date / time and venue lines; an older post's
    -- type of assistance and requirements are then already in its details.
    v_short := nullif(concat_ws(E'\n', v_when, 'Venue: ' || nullif(btrim(r.venue), '')), '');
    v_used := v_lines;
    v_keep := nullif(concat_ws(E'\n',
      'Type of assistance: ' || nullif(btrim(r.assistance_type), ''),
      'Requirements: ' || nullif(btrim(r.requirements), '')
    ), '');

    v_rest := r.body;
    if v_title is not null then
      if v_rest = v_title then
        v_rest := '';
      elsif left(v_rest, char_length(v_title) + 2) = v_title || E'\n\n' then
        v_rest := substr(v_rest, char_length(v_title) + 3);
      else
        v_rest := null;
      end if;
    end if;
    if v_rest is not null and v_lines is not null then
      if v_rest = v_lines then
        v_rest := '';
      elsif right(v_rest, char_length(v_lines) + 2) = E'\n\n' || v_lines then
        v_rest := left(v_rest, char_length(v_rest) - char_length(v_lines) - 2);
      elsif v_short is not null and v_rest = v_short then
        v_rest := '';
        v_used := v_short;
        v_keep := null;
      elsif v_short is not null and right(v_rest, char_length(v_short) + 2) = E'\n\n' || v_short then
        v_rest := left(v_rest, char_length(v_rest) - char_length(v_short) - 2);
        v_used := v_short;
        v_keep := null;
      else
        v_rest := null;
      end if;
    end if;
    -- Only when putting it back together gives exactly the current text.
    if v_rest is not null and concat_ws(E'\n\n', v_title, nullif(btrim(v_rest), ''), v_used) is not distinct from r.body then
      update public.announcements
      set body = coalesce(concat_ws(E'\n\n', nullif(btrim(v_rest), ''), v_keep), ''),
          all_barangays = false, barangay_ids = array[v_langapud]
      where announcement_id = r.announcement_id;
    elsif v_title is not null and btrim(split_part(btrim(r.body), E'\n', 1)) = v_title then
      -- A post written as text only: its first line is the title.
      update public.announcements
      set body = btrim(substr(btrim(r.body), char_length(split_part(btrim(r.body), E'\n', 1)) + 1), E' \t\r\n'),
          all_barangays = false, barangay_ids = array[v_langapud]
      where announcement_id = r.announcement_id;
    else
      update public.announcements set all_barangays = false, barangay_ids = array[v_langapud]
      where announcement_id = r.announcement_id;
    end if;
  end loop;
end;
$$;

-- --------------------------------------------------------------- reading
drop policy if exists "announcements: audience reads published" on public.announcements;
create policy "announcements: audience reads published" on public.announcements for select
  using (
    status = 'published' and deleted_at is null
    and (
      (audience in ('farmers', 'everyone') and (select public.current_role()) = 'farmer')
      or (audience in ('fa_president', 'everyone') and (select public.current_role()) = 'fa_president')
    )
    and (all_barangays or (select public.my_barangay_id()) = any (barangay_ids))
  );

-- ----------------------------------------------------------- notifications
-- "MAO Labangan posted an announcement" with the title, to the farmers
-- and/or Farmers' Association Presidents who can see the post.
create or replace function public.notify_post_audience(p_title text, p_all boolean, p_barangays bigint[], p_farmers boolean, p_fa boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_notifications (user_id, type, title, message, link)
  select p.id, 'announcement', 'MAO Labangan posted an announcement', public.post_first_line(p_title), '/announcements'
  from public.profiles p
  where ((p_farmers and p.role = 'farmer') or (p_fa and p.role = 'fa_president'))
    and (p_all or public.user_barangay_id(p.id) = any (p_barangays))
$$;
revoke execute on function public.notify_post_audience(text, boolean, bigint[], boolean, boolean) from anon, authenticated, public;

create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published' and new.deleted_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.notify_post_audience(new.title, new.all_barangays, new.barangay_ids,
      new.audience in ('farmers', 'everyone'), new.audience in ('fa_president', 'everyone'));
  end if;
  return new;
end;
$$;

-- A Farmers' Association President can still forward a post meant for them
-- to farmers (it becomes visible to farmers in the same barangays).
create or replace function public.forward_announcement_to_farmers(p_announcement_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_mine bigint := public.my_barangay_id();
begin
  if public.current_role() <> 'fa_president' then
    raise exception 'Only the Farmers'' Association President can forward announcements.';
  end if;

  select * into a from public.announcements
  where announcement_id = p_announcement_id and audience = 'fa_president' and status = 'published' and deleted_at is null
    and (all_barangays or v_mine = any (barangay_ids));
  if not found then
    raise exception 'Announcement not found or not available to forward.';
  end if;

  update public.announcements
  set for_all_registered_farmers = true, forwarded_by = auth.uid(), forwarded_at = now()
  where announcement_id = p_announcement_id;

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes)
  values (
    auth.uid(), 'fa_president', 'announcements', 'forward', p_announcement_id::text,
    'Forwarded announcement "' || a.title || '" to farmers',
    jsonb_build_object('old', to_jsonb(a), 'new', jsonb_build_object('for_all_registered_farmers', true))
  );

  perform public.notify_post_audience(a.title, a.all_barangays, a.barangay_ids, true, false);
end;
$$;

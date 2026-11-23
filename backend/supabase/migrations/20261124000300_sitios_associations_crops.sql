-- Managed lists for the farmer form (Nov 24, 2026): sitios/puroks, farmers'
-- associations and crops.
--
--   * New tables sitios, associations and crop_types (id, name, is_active,
--     created_at). Names are trimmed with single spaces; an all-lowercase
--     name is capitalized ("purok 6" -> "Purok 6"); two names that are the
--     same ignoring case and spaces can't both be on a list.
--   * Each list starts with the values already used in farmer records:
--     Sitio / Purok and Farm Location (minus the barangay, municipality and
--     province names, which aren't sitios), Organization Affiliation, and
--     crop types. Values that are the same ignoring case and spaces become
--     one entry; nothing else is merged.
--   * Farmer records point to the lists (addresses.sitio_id,
--     farm_parcels.sitio_id, farmers.association_id, crops.crop_type_id).
--     Existing records are linked only where the text is the same ignoring
--     case and spaces; the old text is kept as it was (nothing is lost).
--     Three records the team keeps unchanged (Maui Pelaez, Claude Oclarit,
--     Luna Cuizon) are not linked; the apps match them by name.
--   * The text columns stay and always show the list name (renaming an
--     entry renames it on the linked records). Barangay, municipality and
--     province are fixed: Langapud, Labangan, Zamboanga del Sur.
--   * Who may change the lists: everyone signed in reads them; the MAO Admin
--     and the Farmers' Association President add sitios and associations;
--     only the MAO Admin adds crops, renames, deactivates or deletes (an
--     entry used by any record can't be deleted, only deactivated).
--   * save_farmer takes the list ids: sitio/purok, commodity/crop, sex and
--     status are required; farm location (a sitio/purok), seed program and
--     farmers' association are optional. A deactivated entry can't be newly
--     chosen (a farmer who already has it keeps it).

-- ---------------------------------------------------------------- the lists
create or replace function public.list_name_key(p text)
returns text
language sql
immutable
as $$ select lower(regexp_replace(coalesce(p, ''), '\s+', '', 'g')) $$;

create table public.sitios (
  id bigint generated always as identity primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid()
);
create table public.associations (
  id bigint generated always as identity primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid()
);
create table public.crop_types (
  id bigint generated always as identity primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid()
);
create unique index sitios_name_key on public.sitios (public.list_name_key(name));
create unique index associations_name_key on public.associations (public.list_name_key(name));
create unique index crop_types_name_key on public.crop_types (public.list_name_key(name));

-- Clean names; a friendly message instead of a unique-index error.
create or replace function public.clean_list_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_existing text;
begin
  new.name := regexp_replace(btrim(coalesce(new.name, '')), '\s+', ' ', 'g');
  if new.name = '' then
    raise exception 'Enter a name.';
  end if;
  if length(new.name) > 80 then
    raise exception 'Keep the name to 80 characters or fewer.';
  end if;
  if new.name = lower(new.name) then
    new.name := initcap(new.name);
  end if;
  execute format('select name from public.%I where public.list_name_key(name) = public.list_name_key($1) and id is distinct from $2 limit 1', TG_TABLE_NAME)
    into v_existing using new.name, new.id;
  if v_existing is not null then
    raise exception '"%" is already on the list.', v_existing;
  end if;
  return new;
end;
$$;
create trigger clean_list_name before insert or update of name on public.sitios for each row execute function public.clean_list_name();
create trigger clean_list_name before insert or update of name on public.associations for each row execute function public.clean_list_name();
create trigger clean_list_name before insert or update of name on public.crop_types for each row execute function public.clean_list_name();

-- ------------------------------------------- starting values from the records
-- When the same name appears with different capitals, the spelling with
-- capitals wins ("Purok 1" over "purok 1").
with place_names as (
  select public.list_name_key(barangay) as k from public.addresses where barangay is not null
  union select public.list_name_key(municipality) from public.addresses where municipality is not null
  union select public.list_name_key(province) from public.addresses where province is not null
),
used as (
  select regexp_replace(btrim(street), '\s+', ' ', 'g') as v from public.addresses where btrim(coalesce(street, '')) <> ''
  union all
  select regexp_replace(btrim(farm_location), '\s+', ' ', 'g') from public.farm_parcels where btrim(coalesce(farm_location, '')) <> ''
)
insert into public.sitios (name)
select v from (
  select distinct on (public.list_name_key(v)) v
  from used
  where public.list_name_key(v) not in (select k from place_names)
  order by public.list_name_key(v), (v = lower(v)), v
) s
order by v;

insert into public.associations (name)
select v from (
  select distinct on (public.list_name_key(v)) v
  from (select regexp_replace(btrim(org_affiliation), '\s+', ' ', 'g') as v from public.farmers where btrim(coalesce(org_affiliation, '')) <> '') u
  order by public.list_name_key(v), (v = lower(v)), v
) s
order by v;

-- Crops: the ones in farmer records, plus the three the form offered.
insert into public.crop_types (name)
select v from (
  select distinct on (public.list_name_key(v)) v
  from (
    select regexp_replace(btrim(crop_type), '\s+', ' ', 'g') as v from public.crops where btrim(coalesce(crop_type, '')) <> ''
    union all select unnest(array['Rice', 'Corn', 'Vegetables'])
  ) u
  order by public.list_name_key(v), (v = lower(v)), v
) s
order by v;

-- --------------------------------------------------------- links from records
alter table public.addresses add column sitio_id bigint references public.sitios (id);
alter table public.farm_parcels add column sitio_id bigint references public.sitios (id);
alter table public.farmers add column association_id bigint references public.associations (id);
alter table public.crops add column crop_type_id bigint references public.crop_types (id);
create index addresses_sitio_id_idx on public.addresses (sitio_id);
create index farm_parcels_sitio_id_idx on public.farm_parcels (sitio_id);
create index farmers_association_id_idx on public.farmers (association_id);
create index crops_crop_type_id_idx on public.crops (crop_type_id);

-- Link existing records where the text is the same ignoring case and
-- spaces. The text itself is left exactly as it was. Not linked: the three
-- records the team keeps unchanged (RSBSA ...000537 Maui Pelaez, ...000612
-- Claude Oclarit, ...000389 Luna Cuizon).

update public.addresses a set sitio_id = s.id
from public.sitios s
where a.sitio_id is null and public.list_name_key(a.street) = public.list_name_key(s.name)
  and a.farmer_id not in (select farmer_id from public.farmers where rsbsa_no in ('09-73-00-000-000537', '09-73-00-000-000612', '09-73-00-000-000389'));

update public.farm_parcels p set sitio_id = s.id
from public.sitios s
where p.sitio_id is null and public.list_name_key(p.farm_location) = public.list_name_key(s.name)
  and p.farmer_id not in (select farmer_id from public.farmers where rsbsa_no in ('09-73-00-000-000537', '09-73-00-000-000612', '09-73-00-000-000389'));

update public.farmers f set association_id = x.id
from public.associations x
where f.association_id is null and public.list_name_key(f.org_affiliation) = public.list_name_key(x.name)
  and f.farmer_id not in (select farmer_id from public.farmers where rsbsa_no in ('09-73-00-000-000537', '09-73-00-000-000612', '09-73-00-000-000389'));

update public.crops c set crop_type_id = t.id
from public.crop_types t, public.farm_parcels p
where c.crop_type_id is null and p.parcel_id = c.parcel_id
  and public.list_name_key(c.crop_type) = public.list_name_key(t.name)
  and p.farmer_id not in (select farmer_id from public.farmers where rsbsa_no in ('09-73-00-000-000537', '09-73-00-000-000612', '09-73-00-000-000389'));

-- ------------------------------------- the text always shows the list name
-- (from here on: choosing an entry sets the text; renaming an entry renames
-- it on every linked record).
create or replace function public.sync_list_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_TABLE_NAME = 'addresses' then
    if new.sitio_id is not null and (TG_OP = 'INSERT' or new.sitio_id is distinct from old.sitio_id) then
      select name into new.street from public.sitios where id = new.sitio_id;
    end if;
  elsif TG_TABLE_NAME = 'farm_parcels' then
    if new.sitio_id is not null and (TG_OP = 'INSERT' or new.sitio_id is distinct from old.sitio_id) then
      select name into new.farm_location from public.sitios where id = new.sitio_id;
    end if;
  elsif TG_TABLE_NAME = 'farmers' then
    if new.association_id is not null and (TG_OP = 'INSERT' or new.association_id is distinct from old.association_id) then
      select name into new.org_affiliation from public.associations where id = new.association_id;
    end if;
  elsif TG_TABLE_NAME = 'crops' then
    if new.crop_type_id is not null and (TG_OP = 'INSERT' or new.crop_type_id is distinct from old.crop_type_id) then
      select name into new.crop_type from public.crop_types where id = new.crop_type_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger sync_list_text before insert or update of sitio_id on public.addresses for each row execute function public.sync_list_text();
create trigger sync_list_text before insert or update of sitio_id on public.farm_parcels for each row execute function public.sync_list_text();
create trigger sync_list_text before insert or update of association_id on public.farmers for each row execute function public.sync_list_text();
create trigger sync_list_text before insert or update of crop_type_id on public.crops for each row execute function public.sync_list_text();

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
  end if;
  return new;
end;
$$;
create trigger rename_list_entry after update of name on public.sitios for each row when (old.name is distinct from new.name) execute function public.rename_list_entry();
create trigger rename_list_entry after update of name on public.associations for each row when (old.name is distinct from new.name) execute function public.rename_list_entry();
create trigger rename_list_entry after update of name on public.crop_types for each row when (old.name is distinct from new.name) execute function public.rename_list_entry();

-- ------------------------------------------------------------------- access
alter table public.sitios enable row level security;
alter table public.associations enable row level security;
alter table public.crop_types enable row level security;

create policy "sitios: signed-in users read" on public.sitios for select to authenticated using (true);
create policy "sitios: staff add" on public.sitios for insert to authenticated
  with check (public.current_role() in ('mao_admin', 'fa_president') and is_active);
create policy "sitios: MAO edits" on public.sitios for update to authenticated
  using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');
create policy "sitios: MAO deletes" on public.sitios for delete to authenticated using (public.current_role() = 'mao_admin');

create policy "associations: signed-in users read" on public.associations for select to authenticated using (true);
create policy "associations: staff add" on public.associations for insert to authenticated
  with check (public.current_role() in ('mao_admin', 'fa_president') and is_active);
create policy "associations: MAO edits" on public.associations for update to authenticated
  using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');
create policy "associations: MAO deletes" on public.associations for delete to authenticated using (public.current_role() = 'mao_admin');

create policy "crop_types: signed-in users read" on public.crop_types for select to authenticated using (true);
create policy "crop_types: MAO adds" on public.crop_types for insert to authenticated with check (public.current_role() = 'mao_admin');
create policy "crop_types: MAO edits" on public.crop_types for update to authenticated
  using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');
create policy "crop_types: MAO deletes" on public.crop_types for delete to authenticated using (public.current_role() = 'mao_admin');

revoke all on public.sitios, public.associations, public.crop_types from anon;
grant select, insert, update, delete on public.sitios, public.associations, public.crop_types to authenticated;

-- How many farmers use each entry (linked, or older text that matches it).
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
  where public.is_staff();
$$;
revoke execute on function public.list_usage() from anon, public;
grant execute on function public.list_usage() to authenticated;

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
  -- renamed: A → B", "Crop deactivated: Vegetables".
  if TG_TABLE_NAME in ('sitios', 'associations', 'crop_types') then
    v_label := case TG_TABLE_NAME when 'sitios' then 'Sitio/Purok' when 'associations' then 'Farmers'' association' else 'Crop' end;
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
create trigger audit_sitios after insert or update or delete on public.sitios for each row execute function public.log_audit_event();
create trigger audit_associations after insert or update or delete on public.associations for each row execute function public.log_audit_event();
create trigger audit_crop_types after insert or update or delete on public.crop_types for each row execute function public.log_audit_event();

-- -------------------------------------------------------------- save_farmer
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
  v_street text;
  v_farm_location text;
  v_org text;
  v_crop_name text;
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
    select a.sitio_id into v_cur_sitio from public.addresses a where a.farmer_id = p_farmer_id order by a.address_id limit 1;
    select p.parcel_id, p.sitio_id, p.farm_location into v_parcel, v_cur_farm_sitio, v_cur_farm_location
    from public.farm_parcels p where p.farmer_id = p_farmer_id order by p.parcel_no, p.parcel_id limit 1;
    select c.crop_type_id into v_cur_crop from public.crops c where c.parcel_id = v_parcel order by c.crop_id limit 1;
    v_parcel := null;
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

    insert into public.addresses (farmer_id, street, sitio_id, barangay, municipality, province)
    values (v_id, v_street, v_sitio, 'Langapud', 'Labangan', 'Zamboanga del Sur');

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
    barangay = 'Langapud',
    municipality = 'Labangan',
    province = 'Zamboanga del Sur'
  where farmer_id = v_id;
  if not found then
    insert into public.addresses (farmer_id, street, sitio_id, barangay, municipality, province)
    values (v_id, v_street, v_sitio, 'Langapud', 'Labangan', 'Zamboanga del Sur');
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

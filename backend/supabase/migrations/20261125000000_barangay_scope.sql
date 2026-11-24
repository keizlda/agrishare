-- Barangay scope (Nov 25, 2026): the MAO's official list of the 25 barangays
-- of Labangan, and each Farmers' Association President limited to their own
-- barangay.
--
--   * Official names: Langapud is renamed Langapod, and Balimbingan, Lower
--     and Upper Campo Islam get their official names (the same rows, so
--     everything linked stays linked). A barangay remembers its former names
--     (former_names), so a record that still has the old name as text keeps
--     matching it. "Lagalipan" and "Dev Barangay …" test entries are removed
--     when nothing uses them.
--   * Distributions belong to a barangay (distribution_events.barangay_id;
--     the barangay text always shows its name). New and edited distributions
--     need one.
--   * Sitios/puroks and farmers' associations belong to a barangay; the same
--     name can be on the lists of two barangays. Records that used another
--     barangay's entry get their own barangay's entry of the same name.
--   * A Farmers' Association President sees and acts on their own
--     barangay's farmers (and addresses, parcels, crops), requests, proof of
--     planting, harvest reports, distributions and beneficiaries, profiles
--     and photos only (RLS, including storage). Notifications about a
--     farmer go to the Farmers' Association President of that farmer's
--     barangay. Farmers see the distributions of their barangay (and the
--     ones they're tagged in).
--   * Accounts: a Farmers' Association President account needs a barangay;
--     the MAO Admin creates them and assigns the barangay in Settings. The
--     role (and barangay) of a new account come from app_metadata, which only
--     the server can set — never from what a person signs up with.
--   * The activity log records the barangay each entry is about
--     (audit_logs.barangay_id), so it can be filtered by barangay.
--   * The approximate center on file for Langapod (the only one) is kept on
--     the barangay, for the "far from the barangay" photo check.

-- ------------------------------------------------- barangays: former names
alter table public.barangays add column former_names text[] not null default '{}';
alter table public.barangays add column center_lat numeric;
alter table public.barangays add column center_lng numeric;

-- The barangay a name stands for: its current name, or a former one
-- (ignoring case and spaces).
create or replace function public.barangay_id_for(p_text text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select b.id from public.barangays b
  where nullif(btrim(coalesce(p_text, '')), '') is not null
    and (public.list_name_key(b.name) = public.list_name_key(p_text)
         or exists (select 1 from unnest(b.former_names) f where public.list_name_key(f) = public.list_name_key(p_text)))
  order by (public.list_name_key(b.name) = public.list_name_key(p_text)) desc, b.id
  limit 1
$$;

-- A renamed barangay keeps its old name in former_names; no barangay can
-- take another barangay's former name.
create or replace function public.barangay_former_names()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_other text;
begin
  select b.name into v_other from public.barangays b
  where b.id is distinct from new.id
    and exists (select 1 from unnest(b.former_names) f where public.list_name_key(f) = public.list_name_key(new.name))
  limit 1;
  if v_other is not null then
    raise exception '"%" is a former name of %.', new.name, v_other;
  end if;
  if TG_OP = 'UPDATE' and public.list_name_key(old.name) <> public.list_name_key(new.name) then
    new.former_names := array_append(new.former_names, old.name);
  end if;
  new.former_names := array(select distinct f from unnest(new.former_names) f where public.list_name_key(f) <> public.list_name_key(new.name));
  return new;
end;
$$;
create trigger zz_barangay_former_names before insert or update of name on public.barangays
  for each row execute function public.barangay_former_names();

-- ------------------------------------------- distributions: their barangay
alter table public.distribution_events add column barangay_id bigint references public.barangays (id);

create or replace function public.event_barangay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id bigint;
begin
  if new.barangay_id is not null and (TG_OP = 'INSERT' or new.barangay_id is distinct from old.barangay_id) then
    select name into v_name from public.barangays where id = new.barangay_id;
    new.barangay := coalesce(v_name, new.barangay);
  elsif TG_OP = 'INSERT' or new.barangay is distinct from old.barangay then
    v_id := public.barangay_id_for(new.barangay);
    new.barangay_id := v_id;
    if v_id is not null then
      select name into v_name from public.barangays where id = v_id;
      new.barangay := v_name;
    end if;
  end if;
  return new;
end;
$$;
create trigger event_barangay before insert or update of barangay, barangay_id on public.distribution_events
  for each row execute function public.event_barangay();

-- Linking and renaming distributions isn't a change anyone made: no audit rows.
alter table public.distribution_events disable trigger audit_distribution_events;
update public.distribution_events set barangay_id = public.barangay_id_for(barangay) where barangay_id is null;

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
    update public.distribution_events set barangay = new.name where barangay_id = new.id;
  end if;
  return new;
end;
$$;

-- --------------------------------------------- the MAO's official list (25)
update public.barangays set name = 'Langapod' where public.list_name_key(name) = 'langapud';
update public.barangays set name = 'Balimbingan (West Luya)' where public.list_name_key(name) = 'balimbingan';
update public.barangays set name = 'Lower Campo Islam (Poblacion)' where public.list_name_key(name) = 'lowercampoislam';
update public.barangays set name = 'Upper Campo Islam (Poblacion)' where public.list_name_key(name) = 'uppercampoislam';
insert into public.barangays (name)
select n from unnest(array[
  'Bagalupa', 'Balimbingan (West Luya)', 'Binayan', 'Bokong', 'Bulanit', 'Cogonan', 'Combo', 'Dalapang', 'Dimasangca', 'Dipaya',
  'Langapod', 'Lantian', 'Lower Campo Islam (Poblacion)', 'Lower Pulacan', 'Lower Sang-an', 'New Labangan', 'Noboran', 'Old Labangan',
  'San Isidro', 'Santa Cruz', 'Tapodoc', 'Tawagan Norte', 'Upper Campo Islam (Poblacion)', 'Upper Pulacan', 'Upper Sang-an'
]) n
where public.barangay_id_for(n) is null;
-- Test entries that aren't barangays of Labangan, when nothing uses them.
delete from public.barangays b
where (public.list_name_key(b.name) = 'lagalipan' or b.name ilike 'Dev Barangay %')
  and not exists (select 1 from public.addresses a where a.barangay_id = b.id)
  and not exists (select 1 from public.profiles p where p.barangay_id = b.id)
  and not exists (select 1 from public.distribution_events e where e.barangay_id = b.id)
  and not exists (select 1 from public.announcements x where b.id = any (x.barangay_ids));
alter table public.distribution_events enable trigger audit_distribution_events;

update public.barangays set center_lat = 7.8333, center_lng = 123.6333 where name = 'Langapod';
update public.org_settings set address = replace(address, 'Langapud', 'Langapod') where address like '%Langapud%';

-- ------------------------------------------------ users' and farmers' barangay
create or replace function public.farmer_barangay_id(p_farmer_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(a.barangay_id, public.barangay_id_for(a.barangay))
  from public.addresses a where a.farmer_id = p_farmer_id
  order by a.address_id limit 1
$$;

create or replace function public.user_barangay_id(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case (select role from public.profiles where id = p_user)
    when 'farmer' then (
      select public.farmer_barangay_id(f.farmer_id) from public.farmers f
      where f.profile_id = p_user and f.deleted_at is null order by f.farmer_id limit 1)
    when 'fa_president' then (select barangay_id from public.profiles where id = p_user)
  end
$$;
revoke execute on function public.user_barangay_id(uuid) from anon, authenticated, public;

-- Can the signed-in MAO Admin / Farmers' Association President see this
-- farmer's records (or this barangay's)? The MAO Admin sees all; a Farmers'
-- Association President only their own barangay; anyone else none (farmers
-- have their own "own records" rules).
create or replace function public.staff_sees_farmer(p_farmer_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_role()
    when 'mao_admin' then true
    when 'fa_president' then coalesce(public.farmer_barangay_id(p_farmer_id) = public.my_barangay_id(), false)
    else false
  end
$$;

create or replace function public.staff_sees_barangay(p_barangay_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_role()
    when 'mao_admin' then true
    when 'fa_president' then coalesce(p_barangay_id = public.my_barangay_id(), false)
    else false
  end
$$;

-- Storage folders: crop and harvest photos are under the farmer's id,
-- avatars under the user's id.
create or replace function public.staff_sees_farmer_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_folder ~ '^[0-9]+$' then public.staff_sees_farmer(p_folder::bigint) else false end
$$;

create or replace function public.staff_sees_profile_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() = 'mao_admin' then true
    when public.current_role() = 'fa_president' and p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then exists (
      select 1 from public.profiles p
      where p.id = p_folder::uuid
        and (p.role = 'mao_admin'
             or (p.role = 'fa_president' and p.barangay_id = public.my_barangay_id())
             or exists (select 1 from public.farmers f where f.profile_id = p.id and public.staff_sees_farmer(f.farmer_id))))
    else false
  end
$$;

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
    v_id := public.barangay_id_for(new.barangay);
    if v_id is not null then
      select name into v_name from public.barangays where id = v_id;
      new.barangay_id := v_id;
      new.barangay := v_name;
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------- sitios and associations per barangay
alter table public.sitios add column barangay_id bigint references public.barangays (id);
alter table public.associations add column barangay_id bigint references public.barangays (id);
update public.sitios set barangay_id = public.barangay_id_for('Langapod') where barangay_id is null;
update public.associations set barangay_id = public.barangay_id_for('Langapod') where barangay_id is null;
alter table public.sitios alter column barangay_id set not null;
alter table public.associations alter column barangay_id set not null;
drop index if exists public.sitios_name_key;
drop index if exists public.associations_name_key;
create unique index sitios_name_key on public.sitios (barangay_id, public.list_name_key(name));
create unique index associations_name_key on public.associations (barangay_id, public.list_name_key(name));

-- Same-name check: within the barangay for sitios and associations.
create or replace function public.clean_list_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_existing text;
  v_brgy bigint;
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
  if TG_TABLE_NAME in ('sitios', 'associations') then
    v_brgy := (to_jsonb(new) ->> 'barangay_id')::bigint;
    execute format('select name from public.%I where public.list_name_key(name) = public.list_name_key($1) and barangay_id is not distinct from $3 and id is distinct from $2 limit 1', TG_TABLE_NAME)
      into v_existing using new.name, new.id, v_brgy;
    if v_existing is not null then
      raise exception '"%" is already on this barangay''s list.', v_existing;
    end if;
  else
    execute format('select name from public.%I where public.list_name_key(name) = public.list_name_key($1) and id is distinct from $2 limit 1', TG_TABLE_NAME)
      into v_existing using new.name, new.id;
    if v_existing is not null then
      raise exception '"%" is already on the list.', v_existing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists clean_list_name on public.sitios;
drop trigger if exists clean_list_name on public.associations;
create trigger clean_list_name before insert or update of name, barangay_id on public.sitios for each row execute function public.clean_list_name();
create trigger clean_list_name before insert or update of name, barangay_id on public.associations for each row execute function public.clean_list_name();

-- Records that use another barangay's entry get their own barangay's entry
-- with the same name (added when missing). Only records outside Langapod
-- can be affected (everything was on Langapod's lists until now).
insert into public.sitios (name, barangay_id, created_by)
select distinct on (fb.bid, public.list_name_key(s.name)) s.name, fb.bid, null
from (
  select a.sitio_id, public.farmer_barangay_id(a.farmer_id) as bid from public.addresses a where a.sitio_id is not null
  union all
  select p.sitio_id, public.farmer_barangay_id(p.farmer_id) from public.farm_parcels p where p.sitio_id is not null
) fb
join public.sitios s on s.id = fb.sitio_id
where fb.bid is not null and s.barangay_id <> fb.bid
  and not exists (select 1 from public.sitios s2 where s2.barangay_id = fb.bid and public.list_name_key(s2.name) = public.list_name_key(s.name));
update public.addresses a set sitio_id = s2.id
from public.sitios s, public.sitios s2
where s.id = a.sitio_id and s2.barangay_id = public.farmer_barangay_id(a.farmer_id) and s.barangay_id <> s2.barangay_id
  and public.list_name_key(s2.name) = public.list_name_key(s.name);
update public.farm_parcels p set sitio_id = s2.id
from public.sitios s, public.sitios s2
where s.id = p.sitio_id and s2.barangay_id = public.farmer_barangay_id(p.farmer_id) and s.barangay_id <> s2.barangay_id
  and public.list_name_key(s2.name) = public.list_name_key(s.name);
insert into public.associations (name, barangay_id, created_by)
select distinct on (public.farmer_barangay_id(f.farmer_id), public.list_name_key(x.name)) x.name, public.farmer_barangay_id(f.farmer_id), null
from public.farmers f join public.associations x on x.id = f.association_id
where public.farmer_barangay_id(f.farmer_id) is not null and x.barangay_id <> public.farmer_barangay_id(f.farmer_id)
  and not exists (select 1 from public.associations x2 where x2.barangay_id = public.farmer_barangay_id(f.farmer_id) and public.list_name_key(x2.name) = public.list_name_key(x.name));
update public.farmers f set association_id = x2.id
from public.associations x, public.associations x2
where x.id = f.association_id and x2.barangay_id = public.farmer_barangay_id(f.farmer_id) and x.barangay_id <> x2.barangay_id
  and public.list_name_key(x2.name) = public.list_name_key(x.name);

-- ----------------------------------------------------------------- access
-- Farmers and their records.
drop policy if exists "farmers: staff reads all, farmer reads own" on public.farmers;
create policy "farmers: MAO all, FA President own barangay, farmer own" on public.farmers for select
  using (public.staff_sees_farmer(farmer_id) or profile_id = auth.uid());
drop policy if exists "fa_president: toggle farmer status only" on public.farmers;
create policy "fa_president: toggle farmer status only" on public.farmers for update
  using (public.current_role() = 'fa_president' and public.staff_sees_farmer(farmer_id))
  with check (public.current_role() = 'fa_president' and public.staff_sees_farmer(farmer_id)
              and rsbsa_no = (select f2.rsbsa_no from public.farmers f2 where f2.farmer_id = farmers.farmer_id));
drop policy if exists "addresses: staff all, farmer own" on public.addresses;
create policy "addresses: MAO all, FA President own barangay, farmer own" on public.addresses for select
  using (public.staff_sees_farmer(farmer_id) or farmer_id = public.current_farmer_id());
drop policy if exists "farm_parcels: staff all, farmer own" on public.farm_parcels;
create policy "farm_parcels: MAO all, FA President own barangay, farmer own" on public.farm_parcels for select
  using (public.staff_sees_farmer(farmer_id) or farmer_id = public.current_farmer_id());
drop policy if exists "crops: staff all, farmer own" on public.crops;
create policy "crops: MAO all, FA President own barangay, farmer own" on public.crops for select
  using (exists (select 1 from public.farm_parcels fp where fp.parcel_id = crops.parcel_id
                 and (public.staff_sees_farmer(fp.farmer_id) or fp.farmer_id = public.current_farmer_id())));

-- Requests.
drop policy if exists "requests: staff read all, farmer reads own" on public.requests;
create policy "requests: MAO all, FA President own barangay, farmer own" on public.requests for select
  using (public.staff_sees_farmer(farmer_id) or farmer_id = public.current_farmer_id());
drop policy if exists "requests: FA President files for a farmer" on public.requests;
create policy "requests: FA President files for a farmer" on public.requests for insert
  with check (public.current_role() = 'fa_president' and filed_by = auth.uid() and status = 'pending'
              and public.staff_sees_farmer(farmer_id)
              and exists (select 1 from public.farmers f where f.farmer_id = requests.farmer_id and f.deleted_at is null));
drop policy if exists "requests: FA President recommends pending" on public.requests;
create policy "requests: FA President recommends pending" on public.requests for update
  using (public.current_role() = 'fa_president' and status = 'pending' and public.staff_sees_farmer(farmer_id))
  with check (public.current_role() = 'fa_president' and status = 'pending' and public.staff_sees_farmer(farmer_id));

-- Proof of planting and harvest reports.
drop policy if exists "crop_validations: staff read all, farmer reads own" on public.crop_validations;
create policy "crop_validations: MAO all, FA President own barangay, farmer own" on public.crop_validations for select
  using (public.staff_sees_farmer(farmer_id) or farmer_id = public.current_farmer_id());
drop policy if exists "harvest reports: staff read all, farmer reads own" on public.harvest_reports;
create policy "harvest reports: MAO all, FA President own barangay, farmer own" on public.harvest_reports for select
  using (public.staff_sees_farmer(farmer_id) or farmer_id = public.current_farmer_id());
drop policy if exists "harvest reports: FA President edits own filings before verification" on public.harvest_reports;
create policy "harvest reports: FA President edits own filings before verification" on public.harvest_reports for update
  using (public.current_role() = 'fa_president' and submitted_by = auth.uid() and status in ('submitted', 'returned')
         and deleted_at is null and public.staff_sees_farmer(farmer_id))
  with check (public.current_role() = 'fa_president' and submitted_by = auth.uid() and status in ('submitted', 'returned')
              and public.staff_sees_farmer(farmer_id));

-- Distributions and beneficiaries.
drop policy if exists "events: everyone reads" on public.distribution_events;
create policy "events: MAO all, FA President own barangay, farmer own barangay or tagged" on public.distribution_events for select
  using (
    public.current_role() = 'mao_admin'
    or (public.current_role() = 'fa_president' and coalesce(barangay_id, public.barangay_id_for(barangay)) = public.my_barangay_id())
    or (public.current_role() = 'farmer' and (
      coalesce(barangay_id, public.barangay_id_for(barangay)) = public.my_barangay_id()
      or exists (select 1 from public.distribution_claims c where c.event_id = distribution_events.event_id and c.farmer_id = public.current_farmer_id())))
  );
drop policy if exists "event_items: everyone reads" on public.distribution_event_items;
create policy "event_items: with their distribution" on public.distribution_event_items for select
  using (exists (select 1 from public.distribution_events e where e.event_id = distribution_event_items.event_id));
drop policy if exists "claims: staff read all, farmer reads own" on public.distribution_claims;
create policy "claims: MAO all, FA President own barangay, farmer own" on public.distribution_claims for select
  using (public.staff_sees_farmer(farmer_id) or farmer_id = public.current_farmer_id());

-- Profiles: a Farmers' Association President reads the MAO Admin, the
-- Farmers' Association Presidents and the farmers of their barangay.
drop policy if exists "profiles: read own or staff reads all" on public.profiles;
create policy "profiles: own, MAO all, FA President own barangay" on public.profiles for select
  using (
    id = auth.uid()
    or public.current_role() = 'mao_admin'
    or (public.current_role() = 'fa_president' and (
      role = 'mao_admin'
      or (role = 'fa_president' and barangay_id = public.my_barangay_id())
      or exists (select 1 from public.farmers f where f.profile_id = profiles.id and public.staff_sees_farmer(f.farmer_id))))
  );

-- Lists: a Farmers' Association President adds to their barangay's lists.
drop policy if exists "sitios: staff add" on public.sitios;
create policy "sitios: MAO adds, FA President adds to own barangay" on public.sitios for insert to authenticated
  with check (is_active and (public.current_role() = 'mao_admin' or (public.current_role() = 'fa_president' and barangay_id = public.my_barangay_id())));
drop policy if exists "associations: staff add" on public.associations;
create policy "associations: MAO adds, FA President adds to own barangay" on public.associations for insert to authenticated
  with check (is_active and (public.current_role() = 'mao_admin' or (public.current_role() = 'fa_president' and barangay_id = public.my_barangay_id())));

-- Photos.
drop policy if exists "crop photos: farmer reads own, staff reads all" on storage.objects;
create policy "crop photos: farmer own, MAO all, FA President own barangay" on storage.objects for select
  using (bucket_id = 'crop-validation-photos' and (
    public.staff_sees_farmer_folder((storage.foldername(name))[1])
    or (storage.foldername(name))[1] = (select farmers.farmer_id::text from public.farmers where farmers.profile_id = auth.uid())));
drop policy if exists "harvest photos: farmer reads own, staff read all" on storage.objects;
create policy "harvest photos: farmer own, MAO all, FA President own barangay" on storage.objects for select
  using (bucket_id = 'harvest-photos' and (
    public.staff_sees_farmer_folder((storage.foldername(name))[1])
    or (storage.foldername(name))[1] = (public.current_farmer_id())::text));
drop policy if exists "avatars: owner or staff reads" on storage.objects;
create policy "avatars: owner, MAO all, FA President own barangay" on storage.objects for select
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (auth.uid())::text
    or public.staff_sees_profile_folder((storage.foldername(name))[1])));

-- ---------------------------------------------------------- notifications
-- To the Farmers' Association President of the farmer's barangay.
create or replace function public.notify_fa_of_farmer(p_farmer_id bigint, p_type text, p_title text, p_message text, p_link text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_notifications (user_id, type, title, message, link)
  select p.id, p_type, p_title, coalesce(p_message, ''), p_link
  from public.profiles p
  where p.role = 'fa_president' and p.barangay_id is not null
    and p.barangay_id = public.farmer_barangay_id(p_farmer_id)
$$;
revoke execute on function public.notify_fa_of_farmer(bigint, text, text, text, text) from anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.notify_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  farmer_profile uuid;
  farmer_name text;
  commodity_name text;
begin
  select f.profile_id, btrim(f.first_name || ' ' || f.surname) into farmer_profile, farmer_name
  from public.farmers f where f.farmer_id = new.farmer_id;
  select c.name || coalesce(' · ' || t.name, '') into commodity_name
  from public.commodities c left join public.commodity_types t on t.commodity_type_id = new.commodity_type_id
  where c.commodity_id = new.commodity_id;

  if tg_op = 'INSERT' then
    if new.filed_by is not null then
      perform public.notify_role(
        'mao_admin', 'request', 'New commodity request',
        'The Farmers'' Association President filed a request for ' || coalesce(commodity_name, 'a commodity')
          || ' on behalf of ' || coalesce(farmer_name, 'a farmer') || '.',
        '/requests?status=pending'
      );
      perform public.notify_user(
        farmer_profile, 'request', 'A request was filed for you',
        'Your Farmers'' Association President filed a request for ' || coalesce(commodity_name, 'a commodity')
          || ' on your behalf. It is now with the MAO.',
        '/requests'
      );
    else
      perform public.notify_role(
        'mao_admin', 'request', 'New commodity request',
        coalesce(farmer_name, 'A farmer') || ' requested ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests?status=pending'
      );
      perform public.notify_fa_of_farmer(new.farmer_id, 'request', 'New commodity request',
        coalesce(farmer_name, 'A farmer') || ' requested ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests?status=pending'
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if new.fa_recommended and not old.fa_recommended then
      perform public.notify_role(
        'mao_admin', 'request', 'Request recommended',
        'The Farmers'' Association President recommended ' || coalesce(farmer_name, 'a farmer') || '''s request for '
          || coalesce(commodity_name, 'a commodity') || '.',
        '/requests?status=pending'
      );
    end if;
    if old.status is distinct from new.status and new.status in ('approved', 'rejected') then
      perform public.notify_user(
        farmer_profile, 'request',
        'Your request was ' || new.status,
        'Your request for ' || coalesce(commodity_name, 'a commodity') || ' was ' || new.status || ' by the MAO.'
          || coalesce(' Remarks: ' || nullif(btrim(new.mao_remarks), ''), ''),
        '/requests'
      );
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_harvest_report_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_farmer record;
  v_role public.user_role;
  v_what text;
  v_link text := '/validation/harvest/' || new.harvest_report_id;
begin
  select f.profile_id, btrim(f.first_name || ' ' || f.surname) as name into v_farmer from public.farmers f where f.farmer_id = new.farmer_id;
  -- Who filed it (the farmer, the Farmers' Association President or the
  -- MAO Admin) decides who is told about a new report.
  select role into v_role from public.profiles where id = coalesce(new.submitted_by, auth.uid());
  v_what := rtrim(rtrim(to_char(new.yield_kg, 'FM999,999,990.00'), '0'), '.') || ' kg of ' || coalesce((select name from public.commodities where commodity_id = new.commodity_id), 'crop')
    || ' (harvested ' || to_char(new.harvest_date, 'FMMon YYYY') || ')';

  if tg_op = 'INSERT' then
    if v_role is null or v_role = 'farmer' then
      perform public.notify_role('mao_admin', 'harvest', 'New harvest report', v_farmer.name || ' reported ' || v_what || '.', v_link);
      perform public.notify_fa_of_farmer(new.farmer_id, 'harvest', 'New harvest report', v_farmer.name || ' reported ' || v_what || '.', v_link);
    else
      if v_role = 'fa_president' then
        perform public.notify_role('mao_admin', 'harvest', 'New harvest report',
          'The Farmers'' Association President reported ' || v_what || ' for ' || v_farmer.name || '.', v_link);
      end if;
      perform public.notify_user(v_farmer.profile_id, 'harvest', 'A harvest was reported for you',
        'Your harvest of ' || v_what || ' was reported for you. The MAO will verify it.', v_link);
    end if;
    return new;
  end if;

  if new.deleted_at is not null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'verified' then
    perform public.notify_user(v_farmer.profile_id, 'harvest', 'Harvest report verified',
      'Your harvest report of ' || v_what || ' was verified by the MAO.' || coalesce(' Remarks: ' || new.review_remarks, ''), v_link);
    if new.submitted_by is distinct from v_farmer.profile_id then
      perform public.notify_user(new.submitted_by, 'harvest', 'Harvest report verified',
        'The harvest report for ' || v_farmer.name || ' (' || v_what || ') was verified.', v_link);
    end if;
  elsif new.status = 'returned' then
    perform public.notify_user(v_farmer.profile_id, 'harvest', 'Harvest report returned',
      'The MAO returned your harvest report of ' || v_what || '. Remarks: ' || coalesce(new.review_remarks, '') || ' Correct it and resubmit.', v_link);
    if new.submitted_by is distinct from v_farmer.profile_id then
      perform public.notify_user(new.submitted_by, 'harvest', 'Harvest report returned',
        'The harvest report for ' || v_farmer.name || ' was returned. Remarks: ' || coalesce(new.review_remarks, ''), v_link);
    end if;
  elsif new.status = 'submitted' and old.status = 'returned' then
    perform public.notify_role('mao_admin', 'harvest', 'Harvest report resubmitted', v_farmer.name || '''s harvest report of ' || v_what || ' was corrected and resubmitted.', v_link);
  end if;
  return new;
end;
$function$;

-- --------------------------------------------------------------- accounts
-- A new account's role and barangay come from app_metadata (set by the
-- server: the account functions and the seed), never from sign-up data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := coalesce(nullif(new.raw_app_meta_data ->> 'role', '')::public.user_role, 'farmer');
  v_brgy bigint;
begin
  if v_role = 'fa_president' then
    select id into v_brgy from public.barangays
    where id::text = nullif(new.raw_app_meta_data ->> 'barangay_id', '') and is_active;
  end if;
  insert into public.profiles (id, role, full_name, contact_no, barangay_id)
  values (new.id, v_role, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.raw_user_meta_data ->> 'contact_no', v_brgy);
  return new;
end;
$$;

alter table public.profiles add constraint profiles_fa_president_barangay
  check (role <> 'fa_president' or barangay_id is not null);

-- Settings → Farmers' Association Presidents (MAO Admin).
create or replace function public.list_fa_presidents()
returns table (id uuid, full_name text, email text, contact_no text, barangay_id bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, u.email::text, p.contact_no, p.barangay_id, p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where p.role = 'fa_president' and public.current_role() = 'mao_admin'
  order by p.full_name
$$;
revoke execute on function public.list_fa_presidents() from anon, public;
grant execute on function public.list_fa_presidents() to authenticated;

create or replace function public.set_fa_president_barangay(p_user uuid, p_barangay bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_old bigint;
  v_fa text;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can assign barangays.';
  end if;
  select name into v_name from public.barangays where id = p_barangay and is_active;
  if v_name is null then
    raise exception 'Choose the barangay from the list.';
  end if;
  select barangay_id, full_name into v_old, v_fa from public.profiles where id = p_user and role = 'fa_president';
  if not found then
    raise exception 'That Farmers'' Association President account wasn''t found.';
  end if;
  if v_old is not distinct from p_barangay then
    return;
  end if;
  update public.profiles set barangay_id = p_barangay where id = p_user;
  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details, barangay_id)
  values (auth.uid(), 'mao_admin', 'profiles', 'update', p_user::text,
          'Farmers'' Association President ' || coalesce(nullif(v_fa, ''), 'account') || ' assigned to Barangay ' || v_name,
          jsonb_build_object('old', jsonb_build_object('barangay_id', v_old), 'new', jsonb_build_object('barangay_id', p_barangay)),
          jsonb_build_object('id', p_user), p_barangay);
end;
$$;
revoke execute on function public.set_fa_president_barangay(uuid, bigint) from anon, public;
grant execute on function public.set_fa_president_barangay(uuid, bigint) to authenticated;

-- ---------------------------------------------------- activity by barangay
alter table public.audit_logs add column barangay_id bigint references public.barangays (id) on delete set null;
create index audit_logs_barangay_idx on public.audit_logs (barangay_id);

-- The barangay an audit entry is about (null when it's about no single one).
create or replace function public.audit_barangay(p_table text, d jsonb)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d is null then null
    when p_table in ('farmers', 'requests', 'crop_validations', 'harvest_reports', 'distribution_claims') and d ? 'farmer_id'
      then public.farmer_barangay_id((d ->> 'farmer_id')::bigint)
    when p_table = 'distribution_events'
      then coalesce((d ->> 'barangay_id')::bigint, public.barangay_id_for(d ->> 'barangay'))
    when p_table = 'distribution_event_items'
      then (select coalesce(e.barangay_id, public.barangay_id_for(e.barangay)) from public.distribution_events e where e.event_id = (d ->> 'event_id')::bigint)
    when p_table = 'sitios'
      then coalesce((d ->> 'barangay_id')::bigint, (select s.barangay_id from public.sitios s where s.id = (d ->> 'id')::bigint))
    when p_table = 'associations'
      then coalesce((d ->> 'barangay_id')::bigint, (select x.barangay_id from public.associations x where x.id = (d ->> 'id')::bigint))
    when p_table = 'barangays'
      then (select b.id from public.barangays b where b.id = (d ->> 'id')::bigint)
    when p_table = 'announcements' and d ->> 'all_barangays' = 'false' and jsonb_array_length(coalesce(d -> 'barangay_ids', '[]'::jsonb)) = 1
      then (d -> 'barangay_ids' ->> 0)::bigint
  end
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details, barangay_id)
  values (
    auth.uid(), actor_role, TG_TABLE_NAME, lower(TG_OP), rec_id,
    v_summary,
    jsonb_build_object('old', old_data, 'new', new_data),
    coalesce(new_data, old_data),
    public.audit_barangay(TG_TABLE_NAME, coalesce(new_data, old_data))
  );
  return coalesce(new, old);
end;
$function$;

update public.audit_logs set barangay_id = public.audit_barangay(table_name, details) where barangay_id is null;

-- ------------------------------------------------------------ the forms
-- A distribution's barangay: required, from the list (a deactivated one is
-- kept when it's already the distribution's).
create or replace function public.require_barangay_name(p_text text, p_current text default null)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_id bigint;
  v_name text;
  v_active boolean;
begin
  if nullif(btrim(coalesce(p_text, '')), '') is null then
    if p_current is not null then
      return p_current;
    end if;
    raise exception 'Choose the barangay.';
  end if;
  v_id := public.barangay_id_for(p_text);
  select name, is_active into v_name, v_active from public.barangays where id = v_id;
  if v_name is null or (not v_active and v_id is distinct from public.barangay_id_for(p_current)) then
    raise exception 'Choose the barangay from the list.';
  end if;
  return v_name;
end;
$$;

CREATE OR REPLACE FUNCTION public.save_distribution(p_event_id bigint, p_event jsonb, p_item_id bigint, p_commodity_id bigint, p_quantity numeric, p_beneficiaries jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_date date := nullif(p_event ->> 'event_date', '')::date;
  v_status public.distribution_status := nullif(p_event ->> 'status', '')::public.distribution_status;
  v_tagged int := coalesce(jsonb_array_length(p_beneficiaries), 0);
  v_total numeric;
  v_alloc numeric := nullif(p_event ->> 'allocation_kg', '')::numeric;
  v_old public.distribution_events%rowtype;
  v_old_commodity bigint;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can record distributions.';
  end if;
  -- A new distribution always starts Ongoing; the MAO Admin marks it
  -- Completed afterwards (status badge or Edit).
  if p_event_id is null then
    v_status := 'ongoing';
  end if;
  if btrim(coalesce(p_event ->> 'program_name', '')) = '' then
    raise exception 'Program name is required.';
  end if;
  if not exists (select 1 from public.commodities where commodity_id = p_commodity_id) then
    raise exception 'Choose a commodity for this distribution.';
  end if;
  if v_alloc is not null and v_alloc <= 0 then
    raise exception 'Enter a barangay allocation greater than 0 kg, or leave it blank.';
  end if;
  if p_event_id is not null then
    select * into v_old from public.distribution_events where event_id = p_event_id and not is_deleted;
    if not found then
      raise exception 'That distribution no longer exists — refresh and try again.';
    end if;
  end if;
  if coalesce(v_status, v_old.status) = 'completed' then
    if v_tagged = 0 and (p_beneficiaries is not null
        or not exists (select 1 from public.distribution_claims where event_id = p_event_id)) then
      raise exception 'Tag at least one beneficiary before marking a distribution Completed.';
    end if;
    if coalesce(v_date, v_old.event_date, v_today) > v_today then
      raise exception 'A completed distribution can''t have a future date.';
    end if;
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_beneficiaries, '[]'::jsonb)) b
             where coalesce((b ->> 'quantity_received')::numeric, 0) <= 0) then
    raise exception 'Each farmer''s quantity must be greater than 0.';
  end if;
  if v_tagged = 0 and coalesce(p_quantity, 0) <= 0 then
    raise exception 'Enter a total quantity greater than 0.';
  end if;

  v_total := case when v_tagged > 0
    then (select sum((b ->> 'quantity_received')::numeric) from jsonb_array_elements(p_beneficiaries) b)
    else p_quantity end;
  if v_alloc is not null and v_total > v_alloc then
    raise exception 'The farmers'' quantities (% kg) are more than the barangay allocation (% kg). Raise the allocation or lower the quantities.',
      to_char(v_total, 'FM999,999,990.##'), to_char(v_alloc, 'FM999,999,990.##');
  end if;

  if p_event_id is null then
    insert into public.distribution_events (program_name, event_date, venue, funding_source, status, beneficiaries_count, barangay, allocation_kg)
    values (
      btrim(p_event ->> 'program_name'), coalesce(v_date, v_today), nullif(btrim(p_event ->> 'venue'), ''),
      nullif(btrim(p_event ->> 'funding_source'), ''), 'ongoing',
      case when v_tagged > 0 then v_tagged else coalesce((p_event ->> 'beneficiaries_count')::int, 0) end,
      public.require_barangay_name(p_event ->> 'barangay'), v_alloc
    )
    returning event_id into v_id;
  else
    update public.distribution_events set
      program_name = btrim(p_event ->> 'program_name'),
      event_date = coalesce(v_date, event_date),
      venue = nullif(btrim(p_event ->> 'venue'), ''),
      barangay = public.require_barangay_name(p_event ->> 'barangay', barangay),
      funding_source = nullif(btrim(p_event ->> 'funding_source'), ''),
      beneficiaries_count = case when v_tagged > 0 then v_tagged else coalesce((p_event ->> 'beneficiaries_count')::int, beneficiaries_count) end,
      allocation_kg = v_alloc,
      status = coalesce(v_status, status),
      status_updated_by = case when v_status is not null and v_status <> status then auth.uid() else status_updated_by end,
      status_updated_at = case when v_status is not null and v_status <> status then now() else status_updated_at end
    where event_id = p_event_id
    returning event_id into v_id;
  end if;

  if p_item_id is not null then
    select commodity_id into v_old_commodity from public.distribution_event_items
    where event_item_id = p_item_id and event_id = v_id;
    update public.distribution_event_items set commodity_id = p_commodity_id, quantity_allocated = v_total
    where event_item_id = p_item_id and event_id = v_id;
    if not found then
      raise exception 'That distribution item no longer exists — refresh and try again.';
    end if;
    if v_old_commodity is distinct from p_commodity_id then
      delete from public.distribution_claims c
      where c.event_id = v_id and c.commodity_id = v_old_commodity
        and exists (select 1 from public.distribution_claims d
                    where d.event_id = v_id and d.commodity_id = p_commodity_id and d.farmer_id = c.farmer_id);
      update public.distribution_claims set commodity_id = p_commodity_id, rate_kg_per_ha = null
      where event_id = v_id and commodity_id = v_old_commodity;
    end if;
  else
    insert into public.distribution_event_items (event_id, commodity_id, quantity_allocated)
    values (v_id, p_commodity_id, v_total)
    on conflict (event_id, commodity_id) do update set quantity_allocated = excluded.quantity_allocated;
  end if;

  if p_beneficiaries is not null then
    perform public.save_distribution_beneficiaries(v_id, p_commodity_id, p_beneficiaries);
  end if;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_farmer(p_farmer_id bigint, p_farmer jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    select a.sitio_id, coalesce(a.barangay_id, public.barangay_id_for(a.barangay))
      into v_cur_sitio, v_cur_brgy
    from public.addresses a where a.farmer_id = p_farmer_id order by a.address_id limit 1;
    select p.parcel_id, p.sitio_id, p.farm_location into v_parcel, v_cur_farm_sitio, v_cur_farm_location
    from public.farm_parcels p where p.farmer_id = p_farmer_id order by p.parcel_no, p.parcel_id limit 1;
    select c.crop_type_id into v_cur_crop from public.crops c where c.parcel_id = v_parcel order by c.crop_id limit 1;
    v_parcel := null;
  end if;

  -- Barangay (required): from the list.
  if not (p_farmer ? 'barangay_id') then
    v_brgy := v_cur_brgy;
  end if;
  if v_brgy is not null then
    select name into v_brgy_name from public.barangays where id = v_brgy and (is_active or id = v_cur_brgy);
  end if;
  if v_brgy_name is null then
    raise exception 'Choose the barangay from the list.';
  end if;

  -- Sitio / Purok (required) and commodity/crop (required): from the lists.
  if v_sitio is not null then
    select name into v_street from public.sitios where id = v_sitio and ((is_active and barangay_id = v_brgy) or id = v_cur_sitio);
  end if;
  if v_street is null then
    raise exception 'Choose the sitio/purok from the barangay''s list.';
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
    select name into v_org from public.associations where id = v_assoc and ((is_active and barangay_id = v_brgy) or id = v_cur_assoc);
    if v_org is null then
      raise exception 'Choose the farmers'' association from the barangay''s list.';
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
$function$;

drop function if exists public.distribution_eligible_farmers(bigint, text, integer, bigint);
CREATE OR REPLACE FUNCTION public.distribution_eligible_farmers(p_commodity_id bigint, p_program_name text, p_year integer, p_exclude_event_id bigint DEFAULT NULL::bigint, p_barangay_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(farmer_id bigint, rsbsa_no text, first_name text, surname text, barangay text, sitio_purok text, crop_type text, farm_size_hectares numeric, avatar_url text, seed_program_id bigint, duplicate_program text, duplicate_date date, duplicate_quantity numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with enrolled as (
    select exists (
      select 1 from public.farmers x
      where x.seed_program_id = p_commodity_id and x.deleted_at is null and x.status = 'active'
    ) as any_enrolled
  )
  select f.farmer_id, f.rsbsa_no, f.first_name, f.surname,
         coalesce(addr.barangay, ''), addr.street,
         crop.crop_type, public.farmer_farm_size(f.farmer_id), p.avatar_url, f.seed_program_id,
         dup.program_name, dup.event_date, dup.quantity_received
  from public.farmers f
  cross join enrolled
  join public.commodities c on c.commodity_id = p_commodity_id
  left join lateral (
    select a.barangay, a.street from public.addresses a where a.farmer_id = f.farmer_id limit 1
  ) addr on true
  left join lateral (
    select cr.crop_type from public.farm_parcels fp join public.crops cr on cr.parcel_id = fp.parcel_id
    where fp.farmer_id = f.farmer_id order by fp.parcel_id limit 1
  ) crop on true
  left join public.profiles p on p.id = f.profile_id
  left join lateral (
    select * from public.find_duplicate_distribution(f.farmer_id, p_commodity_id, p_program_name, p_year, p_exclude_event_id)
  ) dup on nullif(btrim(coalesce(p_program_name, '')), '') is not null
  where public.current_role() = 'mao_admin'
    and (p_barangay_id is null or public.farmer_barangay_id(f.farmer_id) = p_barangay_id)
    and f.deleted_at is null
    and f.status = 'active'
    and case when enrolled.any_enrolled then f.seed_program_id = p_commodity_id
             else lower(btrim(crop.crop_type)) = lower(btrim(c.category)) end
  order by f.surname, f.first_name
$function$;
revoke execute on function public.distribution_eligible_farmers(bigint, text, integer, bigint, bigint) from anon, public;
grant execute on function public.distribution_eligible_farmers(bigint, text, integer, bigint, bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.list_usage()
 RETURNS TABLE(list text, id bigint, uses bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'sitios', s.id, (
    select count(distinct u.farmer_id) from (
      select a.farmer_id from public.addresses a
        where a.sitio_id = s.id or (a.sitio_id is null and public.list_name_key(a.street) = public.list_name_key(s.name))
      union all
      select p.farmer_id from public.farm_parcels p
        where p.sitio_id = s.id or (p.sitio_id is null and public.list_name_key(p.farm_location) = public.list_name_key(s.name))
    ) u)
  from public.sitios s
  where public.current_role() = 'mao_admin'
  union all
  select 'associations', x.id, (
    select count(*) from public.farmers f
    where f.association_id = x.id or (f.association_id is null and public.list_name_key(f.org_affiliation) = public.list_name_key(x.name)))
  from public.associations x
  where public.current_role() = 'mao_admin'
  union all
  select 'crop_types', t.id, (
    select count(distinct p.farmer_id) from public.crops c join public.farm_parcels p on p.parcel_id = c.parcel_id
    where c.crop_type_id = t.id or (c.crop_type_id is null and public.list_name_key(c.crop_type) = public.list_name_key(t.name)))
  from public.crop_types t
  where public.current_role() = 'mao_admin'
  union all
  select 'barangays', b.id, (
    select count(distinct a.farmer_id) from public.addresses a join public.farmers f on f.farmer_id = a.farmer_id and f.deleted_at is null
    where a.barangay_id = b.id or (a.barangay_id is null and public.barangay_id_for(a.barangay) = b.id))
  from public.barangays b
  where public.current_role() = 'mao_admin';
$function$;

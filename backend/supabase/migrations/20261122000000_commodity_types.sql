-- Client request (MAO presentation, Nov 2026): allocation by hectare with
-- commodity TYPES. Any commodity measured in kg can have one or more types,
-- each with its own rate in kg per hectare (e.g. Rice Seeds: "Inbred (RCEF)"
-- 40 kg/ha, "Hybrid" 15 kg/ha). Types and rates live here and are managed by
-- the MAO Admin; nothing about them is in the code.
--
-- This replaces the single per-commodity rate from 20261121000000 (its
-- columns allocation_per_hectare / pack_size / max_per_farmer stay but are no
-- longer used), folds the separate "Hybrid Rice Seeds" commodity into Rice
-- Seeds as a type, adds a "Program / type" to the farmer profile, a barangay
-- allocation (kg) to distributions, and keeps the type and rate used on each
-- beneficiary row so later rate changes never alter past distributions.

-- ---------------------------------------------------------------------------
-- Types and rates
-- ---------------------------------------------------------------------------
create table public.commodity_types (
  commodity_type_id bigint generated always as identity primary key,
  commodity_id bigint not null references public.commodities (commodity_id),
  name text not null,
  rate_kg_per_ha numeric(10, 2) not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) default auth.uid(),
  deleted_at timestamptz,
  constraint commodity_types_rate_range check (rate_kg_per_ha > 0 and rate_kg_per_ha <= 1000),
  constraint commodity_types_name_length check (char_length(btrim(name)) between 1 and 60)
);
create unique index commodity_types_active_name_key on public.commodity_types (commodity_id, lower(btrim(name))) where deleted_at is null;
create unique index commodity_types_one_default on public.commodity_types (commodity_id) where is_default and deleted_at is null;
create index commodity_types_commodity_idx on public.commodity_types (commodity_id);

comment on table public.commodity_types is 'Types of a kg commodity (e.g. Inbred (RCEF), Hybrid) with their kg-per-hectare rates. Managed by the MAO Admin.';

alter table public.commodity_types enable row level security;
revoke all on public.commodity_types from anon;
grant select, insert, update on public.commodity_types to authenticated;

-- Everyone signed in reads them (the Farmers' Association President views
-- rates; farmers see suggested quantities); only the MAO Admin changes them.
create policy "commodity types: signed-in users read" on public.commodity_types
  for select to authenticated using (true);
create policy "commodity types: MAO adds" on public.commodity_types
  for insert to authenticated with check (public.current_role() = 'mao_admin');
create policy "commodity types: MAO edits" on public.commodity_types
  for update to authenticated using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

-- Field rules; kg only; one default per commodity; who/when stamped.
create or replace function public.commodity_type_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_unit text;
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' then
    raise exception 'Enter a name for each type.';
  end if;
  if char_length(new.name) > 60 then
    raise exception 'Keep type names to 60 characters or fewer.';
  end if;
  if new.rate_kg_per_ha is null or new.rate_kg_per_ha <= 0 or new.rate_kg_per_ha > 1000 then
    raise exception 'Enter a rate above 0 and up to 1,000 kg per hectare for %.', new.name;
  end if;
  if new.rate_kg_per_ha <> round(new.rate_kg_per_ha, 2) then
    raise exception 'Use up to 2 decimals for the rate of %.', new.name;
  end if;
  select unit into v_unit from public.commodities where commodity_id = new.commodity_id;
  if new.deleted_at is null and lower(btrim(coalesce(v_unit, ''))) <> 'kg' then
    raise exception 'Types and rates are only for commodities measured in kg.';
  end if;
  if new.deleted_at is null and exists (
    select 1 from public.commodity_types t
    where t.commodity_id = new.commodity_id and t.deleted_at is null
      and lower(t.name) = lower(new.name)
      and t.commodity_type_id is distinct from new.commodity_type_id
  ) then
    raise exception 'This commodity already has a type named %.', new.name;
  end if;
  if new.deleted_at is not null then
    new.is_default := false;
  end if;
  -- Marking one type as the default un-marks the others.
  if new.is_default then
    update public.commodity_types set is_default = false
    where commodity_id = new.commodity_id and is_default and commodity_type_id is distinct from new.commodity_type_id;
  end if;
  if tg_op = 'UPDATE' then
    if new.commodity_id <> old.commodity_id then
      raise exception 'A type can''t be moved to another commodity.';
    end if;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

create trigger commodity_type_guard before insert or update on public.commodity_types
  for each row execute function public.commodity_type_guard();

-- Activity Log: every type/rate change in plain words (old → new, who, when).
create or replace function public.log_commodity_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commodity text;
  v_summary text;
  v_role public.user_role;
begin
  select name into v_commodity from public.commodities where commodity_id = new.commodity_id;
  if tg_op = 'INSERT' then
    v_summary := 'Added type ' || new.name || ' (' || new.rate_kg_per_ha || ' kg/ha) to ' || v_commodity;
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_summary := 'Removed type ' || old.name || ' (' || old.rate_kg_per_ha || ' kg/ha) from ' || v_commodity;
  else
    v_summary := concat_ws('; ',
      case when new.rate_kg_per_ha <> old.rate_kg_per_ha then
        v_commodity || ' · ' || new.name || ': rate ' || old.rate_kg_per_ha || ' → ' || new.rate_kg_per_ha || ' kg/ha' end,
      case when new.name <> old.name then v_commodity || ': type ' || old.name || ' renamed to ' || new.name end,
      case when new.is_default and not old.is_default then v_commodity || ': ' || new.name || ' is now the default type' end
    );
    if coalesce(v_summary, '') = '' then
      return new;
    end if;
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
  values (
    auth.uid(), v_role, 'commodity_types', lower(tg_op), new.commodity_type_id::text, v_summary,
    jsonb_build_object('old', case when tg_op = 'UPDATE' then to_jsonb(old) end, 'new', to_jsonb(new)),
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger log_commodity_type_change after insert or update on public.commodity_types
  for each row execute function public.log_commodity_type_change();

-- The type a farmer gets when none is chosen: the default, else the first.
create or replace function public.commodity_default_type(p_commodity_id bigint)
returns bigint
language sql
stable
set search_path = public
as $$
  select commodity_type_id from public.commodity_types
  where commodity_id = p_commodity_id and deleted_at is null
  order by is_default desc, commodity_type_id
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Saving a commodity with its types in one go (Add Commodity and the inline
-- edit). p_types: [{ id?, name, rate, is_default, removed? }]; null leaves
-- the types alone. Returns the commodity_id.
-- ---------------------------------------------------------------------------
create or replace function public.save_commodity(p_commodity_id bigint, p_commodity jsonb, p_types jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
  t jsonb;
  v_defaults int;
  v_rate numeric;
  v_unit text := btrim(coalesce(p_commodity ->> 'unit', 'kg'));
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can add or edit commodities and rates.';
  end if;
  if btrim(coalesce(p_commodity ->> 'name', '')) = '' then
    raise exception 'Enter the commodity name.';
  end if;
  if p_types is not null then
    select count(*) into v_defaults from jsonb_array_elements(p_types) e
    where coalesce((e ->> 'is_default')::boolean, false) and not coalesce((e ->> 'removed')::boolean, false);
    if v_defaults > 1 then
      raise exception 'Mark only one type as the default.';
    end if;
    if lower(v_unit) <> 'kg' and exists (select 1 from jsonb_array_elements(p_types) e where not coalesce((e ->> 'removed')::boolean, false)) then
      raise exception 'Types and rates are only for commodities measured in kg.';
    end if;
  end if;

  begin
    if p_commodity_id is null then
      insert into public.commodities (name, category, unit, status)
      values (btrim(regexp_replace(p_commodity ->> 'name', '\s+', ' ', 'g')), p_commodity ->> 'category', v_unit,
              coalesce(nullif(p_commodity ->> 'status', ''), 'active')::public.farmer_status)
      returning commodity_id into v_id;
    else
      update public.commodities set
        name = btrim(regexp_replace(p_commodity ->> 'name', '\s+', ' ', 'g')),
        category = p_commodity ->> 'category',
        unit = v_unit,
        status = coalesce(nullif(p_commodity ->> 'status', ''), status::text)::public.farmer_status
      where commodity_id = p_commodity_id and deleted_at is null
      returning commodity_id into v_id;
      if v_id is null then
        raise exception 'That commodity no longer exists — refresh and try again.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'A commodity with this name already exists.';
  end;

  if p_types is null then
    return v_id;
  end if;
  -- Removals first, then edits and additions (non-defaults before the
  -- default, so the default ends up marked).
  for t in select * from jsonb_array_elements(p_types) e where coalesce((e ->> 'removed')::boolean, false) loop
    update public.commodity_types set deleted_at = now()
    where commodity_type_id = (t ->> 'id')::bigint and commodity_id = v_id and deleted_at is null;
  end loop;
  for t in select * from jsonb_array_elements(p_types) e
           where not coalesce((e ->> 'removed')::boolean, false)
           order by coalesce((e ->> 'is_default')::boolean, false) loop
    -- (The column would round 12.345 silently, so the decimals are checked here.)
    v_rate := nullif(t ->> 'rate', '')::numeric;
    if v_rate is not null and v_rate <> round(v_rate, 2) then
      raise exception 'Use up to 2 decimals for the rate of %.', btrim(coalesce(t ->> 'name', ''));
    end if;
    if nullif(t ->> 'id', '') is null then
      insert into public.commodity_types (commodity_id, name, rate_kg_per_ha, is_default)
      values (v_id, t ->> 'name', nullif(t ->> 'rate', '')::numeric, coalesce((t ->> 'is_default')::boolean, false));
    else
      update public.commodity_types set
        name = t ->> 'name',
        rate_kg_per_ha = nullif(t ->> 'rate', '')::numeric,
        is_default = coalesce((t ->> 'is_default')::boolean, false)
      where commodity_type_id = (t ->> 'id')::bigint and commodity_id = v_id and deleted_at is null;
      if not found then
        raise exception 'The type % was removed by someone else — refresh and try again.', t ->> 'name';
      end if;
    end if;
  end loop;
  -- A commodity with types always has a default (the first one if none).
  if not exists (select 1 from public.commodity_types where commodity_id = v_id and is_default and deleted_at is null) then
    update public.commodity_types set is_default = true
    where commodity_type_id = public.commodity_default_type(v_id);
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_commodity(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.save_commodity(bigint, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Farmer "Program / type", distribution allocation, per-row type and rate
-- ---------------------------------------------------------------------------
alter table public.farmers add column if not exists commodity_type_id bigint references public.commodity_types (commodity_type_id);
alter table public.distribution_events add column if not exists allocation_kg numeric(12, 2);
alter table public.distribution_events add constraint distribution_events_allocation_positive check (allocation_kg is null or allocation_kg > 0);
alter table public.distribution_claims
  add column if not exists commodity_type_id bigint references public.commodity_types (commodity_type_id),
  add column if not exists rate_kg_per_ha numeric(10, 2);
alter table public.requests add column if not exists commodity_type_id bigint references public.commodity_types (commodity_type_id);

comment on column public.farmers.commodity_type_id is 'Program / type for the farmer''s primary commodity (optional).';
comment on column public.distribution_events.allocation_kg is 'Total allocation for the barangay, in kg (optional).';
comment on column public.distribution_claims.rate_kg_per_ha is 'The kg/ha rate used for this farmer when the quantity was set.';

-- A request's or farmer's type must belong to the right commodity.
create or replace function public.check_commodity_type_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type bigint := (to_jsonb(new) ->> 'commodity_type_id')::bigint;
  v_ok boolean;
begin
  if v_type is null or (tg_op = 'UPDATE' and v_type is not distinct from (to_jsonb(old) ->> 'commodity_type_id')::bigint) then
    return new;
  end if;
  if tg_table_name = 'farmers' then
    -- The farmer's primary crop (first parcel's first crop) must be the
    -- type's commodity category.
    select exists (
      select 1 from public.commodity_types t join public.commodities c using (commodity_id)
      where t.commodity_type_id = v_type and t.deleted_at is null
        and lower(btrim(c.category)) = (
          select lower(btrim(cr.crop_type)) from public.farm_parcels fp join public.crops cr on cr.parcel_id = fp.parcel_id
          where fp.farmer_id = new.farmer_id order by fp.parcel_no, fp.parcel_id, cr.crop_id limit 1)
    ) into v_ok;
    if not v_ok then
      raise exception 'Choose a program / type for the farmer''s crop.';
    end if;
  else
    select exists (select 1 from public.commodity_types t where t.commodity_type_id = v_type and t.commodity_id = new.commodity_id) into v_ok;
    if not v_ok then
      raise exception 'That type doesn''t belong to the chosen commodity.';
    end if;
  end if;
  return new;
end;
$$;

create trigger check_commodity_type_match before insert or update on public.requests
  for each row execute function public.check_commodity_type_match();

-- ---------------------------------------------------------------------------
-- Starting data (all editable on the Commodities page)
-- ---------------------------------------------------------------------------
do $start$
declare
  v_rice bigint;
  v_hybrid_commodity bigint;
  v_hybrid_type bigint;
  v_inbred bigint;
  r record;
begin
  -- Rice seeds: the inbred rice-seed commodity gets "Inbred (RCEF)" 40 and
  -- "Hybrid" 15 kg/ha.
  select commodity_id into v_rice from public.commodities
  where deleted_at is null and category = 'Rice' and unit = 'kg' and name ilike '%seed%' and name not ilike '%hybrid%'
  order by commodity_id limit 1;
  if v_rice is not null then
    insert into public.commodity_types (commodity_id, name, rate_kg_per_ha, is_default)
    values (v_rice, 'Inbred (RCEF)', 40, true) returning commodity_type_id into v_inbred;
    insert into public.commodity_types (commodity_id, name, rate_kg_per_ha, is_default)
    values (v_rice, 'Hybrid', 15, false) returning commodity_type_id into v_hybrid_type;

    -- The separate "Hybrid Rice Seeds" commodity becomes the Hybrid type:
    -- its requests move to Rice Seeds · Hybrid, then it is removed (soft).
    for r in select commodity_id from public.commodities
             where deleted_at is null and category = 'Rice' and name ilike '%hybrid%' and commodity_id <> v_rice loop
      update public.requests set commodity_id = v_rice, commodity_type_id = v_hybrid_type where commodity_id = r.commodity_id;
      if not exists (select 1 from public.distribution_event_items where commodity_id = r.commodity_id)
         and not exists (select 1 from public.distribution_claims where commodity_id = r.commodity_id) then
        update public.commodities set deleted_at = now() where commodity_id = r.commodity_id;
      end if;
    end loop;
  end if;

  -- Any other kg commodity that had a single rate keeps it as "Standard".
  for r in select commodity_id, allocation_per_hectare from public.commodities
           where deleted_at is null and allocation_per_hectare is not null and lower(unit) = 'kg'
             and commodity_id is distinct from v_rice
             and not exists (select 1 from public.commodity_types t where t.commodity_id = commodities.commodity_id) loop
    insert into public.commodity_types (commodity_id, name, rate_kg_per_ha, is_default)
    values (r.commodity_id, 'Standard', least(r.allocation_per_hectare, 1000), true);
  end loop;

  -- Earlier rows tagged by farm size used the commodity's single rate: they
  -- record the default type and that rate.
  update public.distribution_claims c set
    commodity_type_id = public.commodity_default_type(c.commodity_id),
    rate_kg_per_ha = (select allocation_per_hectare from public.commodities x where x.commodity_id = c.commodity_id)
  where c.farm_size_hectares is not null and c.commodity_type_id is null
    and exists (select 1 from public.commodity_types t where t.commodity_id = c.commodity_id and t.deleted_at is null);
end;
$start$;

-- ---------------------------------------------------------------------------
-- Allocation: farm size × the type's rate (kg, 2 decimals)
-- ---------------------------------------------------------------------------
create or replace function public.type_allocation(p_type_id bigint, p_farm_size numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select round(p_farm_size * rate_kg_per_ha, 2) from public.commodity_types where commodity_type_id = p_type_id
$$;
grant execute on function public.type_allocation(bigint, numeric) to authenticated;

create or replace function public.save_distribution_beneficiaries(
  p_event_id bigint,
  p_commodity_id bigint,
  p_beneficiaries jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b jsonb;
  incoming_farmer_ids bigint[];
  v_farmer bigint;
  v_qty numeric;
  v_reason text;
  v_type bigint;
  v_rate numeric;
  v_size numeric;
  v_computed numeric;
  v_adjusted boolean;
  v_unchanged boolean;
  v_found boolean;
  v_name text;
  v_old public.distribution_claims%rowtype;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only MAO Admin can tag distribution beneficiaries.';
  end if;

  select coalesce(array_agg((elem ->> 'farmer_id')::bigint), '{}')
    into incoming_farmer_ids
    from jsonb_array_elements(p_beneficiaries) elem;

  delete from public.distribution_claims
  where event_id = p_event_id
    and commodity_id = p_commodity_id
    and not (farmer_id = any (incoming_farmer_ids));

  for b in select * from jsonb_array_elements(p_beneficiaries) loop
    v_farmer := (b ->> 'farmer_id')::bigint;
    v_qty := (b ->> 'quantity_received')::numeric;
    v_reason := nullif(btrim(coalesce(b ->> 'adjustment_reason', '')), '');
    v_type := nullif(b ->> 'commodity_type_id', '')::bigint;

    select * into v_old from public.distribution_claims
    where event_id = p_event_id and commodity_id = p_commodity_id and farmer_id = v_farmer;
    v_found := found;
    -- A new row without a type gets the commodity's default type.
    if v_type is null and not v_found then
      v_type := public.commodity_default_type(p_commodity_id);
    end if;
    if v_type is not null and not exists (
      select 1 from public.commodity_types t where t.commodity_type_id = v_type and t.commodity_id = p_commodity_id
    ) then
      raise exception 'That type doesn''t belong to the chosen commodity.';
    end if;

    -- A row saved before and not changed now keeps what it had: its farm
    -- size, the rate used then, its adjustment.
    v_unchanged := v_found and v_old.quantity_received = v_qty and v_old.commodity_type_id is not distinct from v_type;
    if v_unchanged then
      v_size := coalesce(v_old.farm_size_hectares, public.farmer_farm_size(v_farmer));
      v_rate := v_old.rate_kg_per_ha;
      v_adjusted := v_old.quantity_adjusted;
      v_reason := coalesce(v_reason, v_old.adjustment_reason);
    else
      v_size := public.farmer_farm_size(v_farmer);
      v_rate := (select rate_kg_per_ha from public.commodity_types where commodity_type_id = v_type and deleted_at is null);
      if v_type is not null and v_rate is null then
        raise exception 'That type was removed — choose another type.';
      end if;
      v_computed := case when v_rate is null then null else round(v_size * v_rate, 2) end;
      if v_computed is not null and v_qty <> v_computed then
        if v_reason is null then
          select first_name || ' ' || surname into v_name from public.farmers where farmer_id = v_farmer;
          raise exception 'Give a short reason for the adjusted quantity of %.', coalesce(v_name, 'a farmer');
        end if;
        v_adjusted := true;
      else
        v_adjusted := false;
        v_reason := null;
      end if;
    end if;

    insert into public.distribution_claims (
      event_id, commodity_id, farmer_id, quantity_received,
      acknowledgement_status, acknowledged_at, duplicate_override_reason, released_by,
      farm_size_hectares, quantity_adjusted, adjustment_reason, commodity_type_id, rate_kg_per_ha
    ) values (
      p_event_id, p_commodity_id, v_farmer, v_qty,
      coalesce((b ->> 'acknowledgement_status')::public.beneficiary_acknowledgement_status, 'pending'),
      case when (b ->> 'acknowledgement_status') = 'received' then now() else null end,
      nullif(b ->> 'duplicate_override_reason', ''), auth.uid(),
      v_size, v_adjusted, v_reason, v_type, v_rate
    )
    on conflict (event_id, commodity_id, farmer_id) do update set
      quantity_received = excluded.quantity_received,
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledged_at = case
        when excluded.acknowledgement_status = 'received' and distribution_claims.acknowledgement_status <> 'received'
          then now()
        when excluded.acknowledgement_status = 'received'
          then distribution_claims.acknowledged_at
        else null
      end,
      duplicate_override_reason = excluded.duplicate_override_reason,
      released_by = excluded.released_by,
      farm_size_hectares = excluded.farm_size_hectares,
      quantity_adjusted = excluded.quantity_adjusted,
      adjustment_reason = excluded.adjustment_reason,
      commodity_type_id = excluded.commodity_type_id,
      rate_kg_per_ha = excluded.rate_kg_per_ha;
  end loop;
end;
$$;

-- save_distribution as before, plus the barangay allocation: the tagged
-- farmers' total may not exceed it (raise the allocation or lower them).
create or replace function public.save_distribution(
  p_event_id bigint,
  p_event jsonb,
  p_item_id bigint,
  p_commodity_id bigint,
  p_quantity numeric,
  p_beneficiaries jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
      nullif(btrim(p_event ->> 'funding_source'), ''), coalesce(v_status, 'ongoing'),
      case when v_tagged > 0 then v_tagged else coalesce((p_event ->> 'beneficiaries_count')::int, 0) end,
      coalesce(nullif(btrim(p_event ->> 'barangay'), ''), 'Langapud'), v_alloc
    )
    returning event_id into v_id;
  else
    update public.distribution_events set
      program_name = btrim(p_event ->> 'program_name'),
      event_date = coalesce(v_date, event_date),
      venue = nullif(btrim(p_event ->> 'venue'), ''),
      barangay = coalesce(nullif(btrim(p_event ->> 'barangay'), ''), barangay),
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
      -- Types belong to a commodity: moved rows lose the old commodity's type.
      update public.distribution_claims set commodity_id = p_commodity_id, commodity_type_id = null, rate_kg_per_ha = null
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
$$;

-- "Add all eligible farmers": now also returns the farmer's type (when it
-- belongs to this commodity) and its rate.
drop function if exists public.distribution_eligible_farmers(bigint, text, integer, bigint);
create function public.distribution_eligible_farmers(
  p_commodity_id bigint,
  p_program_name text,
  p_year integer,
  p_exclude_event_id bigint default null
)
returns table (
  farmer_id bigint, rsbsa_no text, first_name text, surname text, barangay text, sitio_purok text,
  crop_type text, farm_size_hectares numeric, avatar_url text, commodity_type_id bigint,
  duplicate_program text, duplicate_date date, duplicate_quantity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select f.farmer_id, f.rsbsa_no, f.first_name, f.surname,
         coalesce(addr.barangay, 'Langapud'), addr.street,
         crop.crop_type, public.farmer_farm_size(f.farmer_id), p.avatar_url,
         (select t.commodity_type_id from public.commodity_types t
          where t.commodity_type_id = f.commodity_type_id and t.commodity_id = p_commodity_id and t.deleted_at is null),
         dup.program_name, dup.event_date, dup.quantity_received
  from public.farmers f
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
    and f.deleted_at is null
    and f.status = 'active'
    and lower(btrim(crop.crop_type)) = lower(btrim(c.category))
  order by f.surname, f.first_name
$$;

revoke all on function public.distribution_eligible_farmers(bigint, text, integer, bigint) from public, anon;
grant execute on function public.distribution_eligible_farmers(bigint, text, integer, bigint) to authenticated;
grant execute on function public.commodity_default_type(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- save_farmer: also saves the Program / type (optional).
-- ---------------------------------------------------------------------------
create or replace function public.save_farmer(p_farmer_id bigint, p_farmer jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
  v_parcel bigint;
  v_birth date;
  v_size numeric;
  v_type bigint := nullif(p_farmer ->> 'commodity_type_id', '')::bigint;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can register or edit farmers.';
  end if;
  if btrim(coalesce(p_farmer ->> 'first_name', '')) = '' or btrim(coalesce(p_farmer ->> 'surname', '')) = '' then
    raise exception 'First name and last name are required.';
  end if;
  v_birth := nullif(p_farmer ->> 'birth_date', '')::date;
  if v_birth is null or v_birth > current_date then
    raise exception 'Enter a realistic birth date — not in the future.';
  end if;
  v_size := nullif(p_farmer ->> 'farm_size_hectares', '')::numeric;
  if v_size is null or v_size <= 0 then
    raise exception 'Farm size must be greater than 0.';
  end if;
  if v_type is not null and not exists (
    select 1 from public.commodity_types t join public.commodities c using (commodity_id)
    where t.commodity_type_id = v_type and t.deleted_at is null
      and lower(btrim(c.category)) = lower(btrim(coalesce(p_farmer ->> 'crop_type', '')))
  ) then
    raise exception 'Choose a program / type for the farmer''s crop.';
  end if;

  if p_farmer_id is null then
    insert into public.farmers (
      rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no, org_affiliation, status
    ) values (
      btrim(p_farmer ->> 'rsbsa_no'), btrim(p_farmer ->> 'surname'), btrim(p_farmer ->> 'first_name'),
      nullif(btrim(p_farmer ->> 'middle_name'), ''), (p_farmer ->> 'sex')::public.sex_type, v_birth,
      p_farmer ->> 'contact_no', nullif(btrim(p_farmer ->> 'org_affiliation'), ''),
      coalesce(p_farmer ->> 'status', 'active')::public.farmer_status
    )
    returning farmer_id into v_id;

    insert into public.addresses (farmer_id, street, barangay, municipality, province)
    values (v_id, nullif(btrim(p_farmer ->> 'street'), ''), p_farmer ->> 'barangay', p_farmer ->> 'municipality', p_farmer ->> 'province');

    insert into public.farm_parcels (farmer_id, farm_location, farm_size_hectares, ownership_type, is_pcic_insured)
    values (v_id, nullif(btrim(p_farmer ->> 'farm_location'), ''), v_size, nullif(p_farmer ->> 'ownership_type', ''),
            (p_farmer ->> 'is_pcic_insured')::boolean)
    returning parcel_id into v_parcel;

    insert into public.crops (parcel_id, crop_type, area_planted)
    values (v_parcel, p_farmer ->> 'crop_type', v_size);
    update public.farmers set commodity_type_id = v_type where farmer_id = v_id;
    return v_id;
  end if;

  update public.farmers set
    rsbsa_no = btrim(p_farmer ->> 'rsbsa_no'),
    surname = btrim(p_farmer ->> 'surname'),
    first_name = btrim(p_farmer ->> 'first_name'),
    middle_name = nullif(btrim(p_farmer ->> 'middle_name'), ''),
    sex = (p_farmer ->> 'sex')::public.sex_type,
    birth_date = v_birth,
    contact_no = p_farmer ->> 'contact_no',
    org_affiliation = nullif(btrim(p_farmer ->> 'org_affiliation'), ''),
    status = coalesce(p_farmer ->> 'status', 'active')::public.farmer_status
  where farmer_id = p_farmer_id and deleted_at is null
  returning farmer_id into v_id;
  if v_id is null then
    raise exception 'That farmer record no longer exists — refresh and try again.';
  end if;

  update public.addresses set
    street = nullif(btrim(p_farmer ->> 'street'), ''),
    barangay = p_farmer ->> 'barangay',
    municipality = p_farmer ->> 'municipality',
    province = p_farmer ->> 'province'
  where farmer_id = v_id;
  if not found then
    insert into public.addresses (farmer_id, street, barangay, municipality, province)
    values (v_id, nullif(btrim(p_farmer ->> 'street'), ''), p_farmer ->> 'barangay', p_farmer ->> 'municipality', p_farmer ->> 'province');
  end if;

  select parcel_id into v_parcel from public.farm_parcels where farmer_id = v_id order by parcel_no, parcel_id limit 1;
  if v_parcel is null then
    insert into public.farm_parcels (farmer_id, farm_location, farm_size_hectares, ownership_type, is_pcic_insured)
    values (v_id, nullif(btrim(p_farmer ->> 'farm_location'), ''), v_size, nullif(p_farmer ->> 'ownership_type', ''),
            (p_farmer ->> 'is_pcic_insured')::boolean)
    returning parcel_id into v_parcel;
  else
    update public.farm_parcels set
      farm_location = nullif(btrim(p_farmer ->> 'farm_location'), ''),
      farm_size_hectares = v_size,
      ownership_type = nullif(p_farmer ->> 'ownership_type', ''),
      is_pcic_insured = (p_farmer ->> 'is_pcic_insured')::boolean
    where parcel_id = v_parcel;
  end if;

  update public.crops set crop_type = p_farmer ->> 'crop_type', area_planted = v_size
  where crop_id = (select crop_id from public.crops where parcel_id = v_parcel order by crop_id limit 1);
  if not found then
    insert into public.crops (parcel_id, crop_type, area_planted) values (v_parcel, p_farmer ->> 'crop_type', v_size);
  end if;
  update public.farmers set commodity_type_id = v_type where farmer_id = v_id;
  return v_id;
end;
$$;

revoke all on function public.save_farmer(bigint, jsonb) from public, anon;
grant execute on function public.save_farmer(bigint, jsonb) to authenticated;

-- One rate per commodity (Nov 23, 2026).
--
-- Commodity types are retired. Each commodity has ONE optional rate in kg per
-- hectare (commodities.allocation_per_hectare), set by the MAO Admin.
-- Varieties are separate commodities named by the admin, e.g. "Rice Seeds –
-- Inbred (RCEF)" 40 kg/ha and "Rice Seeds – Hybrid" 15 kg/ha.
--
-- Converting what's there (nothing is deleted; the commodity_types table and
-- the commodity_type_id columns stay, unused):
--   * a commodity with several types: each type becomes its own commodity,
--     named "<commodity without its note in brackets> – <type>", with the
--     type's rate. The original commodity stays as it is.
--   * a commodity with one type gets that type's rate.
--   * distribution rows, requests and harvest reports that used a type move
--     to the type's commodity, keeping their saved quantities and rate. A
--     distribution whose rows end up under different commodities is split:
--     the largest group stays, each other group becomes its own distribution
--     ("<program> (<commodity>)").
--   * a farmer's type becomes their Seed program (farmers.seed_program_id).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.commodities
  add column if not exists rate_updated_at timestamptz,
  add column if not exists rate_updated_by uuid references public.profiles (id);

alter table public.farmers
  add column if not exists seed_program_id bigint references public.commodities (commodity_id);
create index if not exists farmers_seed_program_idx on public.farmers (seed_program_id) where deleted_at is null;
comment on column public.farmers.seed_program_id is 'Seed program: the commodity (with a kg/ha rate) the farmer is enrolled in. Optional.';
comment on column public.farmers.commodity_type_id is 'Retired (Nov 23, 2026): replaced by seed_program_id.';
comment on table public.commodity_types is 'Retired (Nov 23, 2026): each commodity has one rate (commodities.allocation_per_hectare). Kept for history.';

-- Types no longer have to match anything.
drop trigger if exists check_commodity_type_match on public.requests;

-- ---------------------------------------------------------------------------
-- Convert types
-- ---------------------------------------------------------------------------
do $convert$
declare
  c record;
  t record;
  v_types int;
  v_target bigint;
  v_name text;
  e record;
  g record;
  v_main bigint;
  v_sibling bigint;
  v_ev public.distribution_events%rowtype;
begin
  create temp table type_map (commodity_type_id bigint primary key, commodity_id bigint not null) on commit drop;

  for c in
    select x.* from public.commodities x
    where exists (select 1 from public.commodity_types y where y.commodity_id = x.commodity_id)
    order by x.commodity_id
  loop
    select count(*) into v_types from public.commodity_types where commodity_id = c.commodity_id and deleted_at is null;

    -- The types to map: active ones, and removed ones that rows still use.
    for t in
      select y.* from public.commodity_types y
      where y.commodity_id = c.commodity_id
        and (y.deleted_at is null
             or exists (select 1 from public.distribution_claims z where z.commodity_type_id = y.commodity_type_id)
             or exists (select 1 from public.requests z where z.commodity_type_id = y.commodity_type_id)
             or exists (select 1 from public.harvest_reports z where z.commodity_type_id = y.commodity_type_id)
             or exists (select 1 from public.farmers z where z.commodity_type_id = y.commodity_type_id))
      order by y.is_default desc, y.commodity_type_id
    loop
      if v_types <= 1 then
        -- One type: the commodity takes its rate.
        insert into type_map values (t.commodity_type_id, c.commodity_id);
        if t.deleted_at is null then
          update public.commodities
             set allocation_per_hectare = t.rate_kg_per_ha, rate_updated_at = coalesce(t.updated_at, now()), rate_updated_by = t.updated_by
           where commodity_id = c.commodity_id;
        end if;
      else
        -- Several types: each type becomes "<name> – <type>".
        v_name := regexp_replace(c.name, '\s*\([^)]*\)\s*$', '') || ' – ' || t.name;
        select commodity_id into v_target from public.commodities where deleted_at is null and lower(name) = lower(v_name) limit 1;
        if v_target is null then
          insert into public.commodities (name, category, unit, status, allocation_per_hectare, rate_updated_at, rate_updated_by)
          values (v_name, c.category, 'kg', case when t.deleted_at is null then c.status else 'inactive' end,
                  t.rate_kg_per_ha, coalesce(t.updated_at, now()), t.updated_by)
          returning commodity_id into v_target;
        end if;
        insert into type_map values (t.commodity_type_id, v_target);
      end if;
    end loop;
  end loop;

  -- Seed program from the farmer's type.
  update public.farmers f set seed_program_id = m.commodity_id
    from type_map m where f.commodity_type_id = m.commodity_type_id and f.seed_program_id is null;

  -- Requests and harvest reports move to their type's commodity (the
  -- harvest guard and notifications are paused: nothing new happens).
  update public.requests r set commodity_id = m.commodity_id, commodity_type_id = null
    from type_map m where r.commodity_type_id = m.commodity_type_id and r.commodity_id <> m.commodity_id;

  alter table public.harvest_reports disable trigger harvest_report_guard;
  alter table public.harvest_reports disable trigger notify_harvest_report_change;
  update public.harvest_reports h set commodity_id = m.commodity_id, commodity_type_id = null
    from type_map m where h.commodity_type_id = m.commodity_type_id and h.commodity_id <> m.commodity_id;
  alter table public.harvest_reports enable trigger harvest_report_guard;
  alter table public.harvest_reports enable trigger notify_harvest_report_change;

  -- Distribution rows: per distribution and old commodity, group the rows by
  -- their new commodity. The largest group stays in the distribution; each
  -- other group gets its own distribution.
  create temp table claim_target on commit drop as
    select z.claim_id, z.event_id, z.commodity_id as old_cid, coalesce(m.commodity_id, z.commodity_id) as new_cid, z.quantity_received
    from public.distribution_claims z left join type_map m on m.commodity_type_id = z.commodity_type_id;

  for e in
    select distinct event_id, old_cid from claim_target where new_cid <> old_cid
  loop
    select new_cid into v_main from claim_target
     where event_id = e.event_id and old_cid = e.old_cid
     group by new_cid order by count(*) desc, (new_cid = e.old_cid) desc, new_cid limit 1;
    select * into v_ev from public.distribution_events where event_id = e.event_id;

    for g in
      select new_cid, count(*) as n, sum(quantity_received) as qty from claim_target
       where event_id = e.event_id and old_cid = e.old_cid group by new_cid
    loop
      if g.new_cid = v_main then
        update public.distribution_claims set commodity_id = g.new_cid, commodity_type_id = case when g.new_cid = e.old_cid then commodity_type_id else null end
         where event_id = e.event_id and commodity_id = e.old_cid
           and claim_id in (select claim_id from claim_target where event_id = e.event_id and old_cid = e.old_cid and new_cid = g.new_cid);
        update public.distribution_event_items set commodity_id = g.new_cid, quantity_allocated = g.qty
         where event_id = e.event_id and commodity_id = e.old_cid;
        update public.distribution_events set beneficiaries_count = g.n where event_id = e.event_id;
      else
        insert into public.distribution_events (
          program_name, event_date, venue, barangay, funding_source, status, completed_at, beneficiaries_count,
          created_at, created_by, status_updated_by, status_updated_at, allocation_kg
        ) values (
          v_ev.program_name || ' (' || (select name from public.commodities where commodity_id = g.new_cid) || ')',
          v_ev.event_date, v_ev.venue, v_ev.barangay, v_ev.funding_source, v_ev.status, v_ev.completed_at, g.n,
          v_ev.created_at, v_ev.created_by, v_ev.status_updated_by, v_ev.status_updated_at, null
        ) returning event_id into v_sibling;
        insert into public.distribution_event_items (event_id, commodity_id, quantity_allocated) values (v_sibling, g.new_cid, g.qty);
        update public.distribution_claims set event_id = v_sibling, commodity_id = g.new_cid, commodity_type_id = null
         where claim_id in (select claim_id from claim_target where event_id = e.event_id and old_cid = e.old_cid and new_cid = g.new_cid);
      end if;
    end loop;
  end loop;
end;
$convert$;

-- ---------------------------------------------------------------------------
-- The rate: MAO Admin only (RLS "commodities: MAO writes"), checked, stamped
-- and in the Activity Log in plain words.
-- ---------------------------------------------------------------------------
create or replace function public.commodity_rate_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Everything added in the app is measured in kilograms. The trusted
    -- server path (service role: seed and maintenance scripts, no signed-in
    -- user) may load an older item with its own unit.
    if auth.uid() is not null or nullif(btrim(coalesce(new.unit, '')), '') is null then
      new.unit := 'kg';
    end if;
  elsif new.unit is distinct from old.unit then
    -- Older commodities keep their unit (shown only).
    new.unit := old.unit;
  end if;
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'Enter the commodity name.';
  end if;
  if new.allocation_per_hectare is not null then
    if new.allocation_per_hectare <= 0 or new.allocation_per_hectare > 1000 then
      raise exception 'Enter an allocation above 0 and up to 1,000 kg per hectare, or leave it blank.';
    end if;
    if lower(btrim(new.unit)) <> 'kg' then
      raise exception 'An allocation per hectare is only for commodities measured in kg.';
    end if;
  end if;
  if tg_op = 'INSERT' and new.allocation_per_hectare is not null
     or tg_op = 'UPDATE' and new.allocation_per_hectare is distinct from old.allocation_per_hectare then
    new.rate_updated_at := now();
    new.rate_updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.rate_updated_at := old.rate_updated_at;
    new.rate_updated_by := old.rate_updated_by;
  end if;
  return new;
end;
$$;

drop trigger if exists commodity_rate_guard on public.commodities;
create trigger commodity_rate_guard before insert or update on public.commodities
  for each row execute function public.commodity_rate_guard();

create or replace function public.log_commodity_rate_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_summary text;
  fmt text := 'FM999,990.00';
begin
  if new.allocation_per_hectare is not distinct from old.allocation_per_hectare then
    return new;
  end if;
  v_summary := new.name || ': allocation '
    || coalesce(to_char(old.allocation_per_hectare, fmt) || ' kg/ha', 'not set') || ' → '
    || coalesce(to_char(new.allocation_per_hectare, fmt) || ' kg/ha', 'not set');
  select role into v_role from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
  values (auth.uid(), v_role, 'commodities', 'update', new.commodity_id::text, v_summary,
          jsonb_build_object('old', jsonb_build_object('allocation_per_hectare', old.allocation_per_hectare),
                             'new', jsonb_build_object('allocation_per_hectare', new.allocation_per_hectare)),
          to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists log_commodity_rate_change on public.commodities;
create trigger log_commodity_rate_change after update on public.commodities
  for each row execute function public.log_commodity_rate_change();

-- ---------------------------------------------------------------------------
-- Distribution rows: farm size × the commodity's rate; the rate used is
-- saved on each row. Unchanged rows keep what they had.
-- ---------------------------------------------------------------------------
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
  v_rate numeric;
  v_size numeric;
  v_computed numeric;
  v_adjusted boolean;
  v_unchanged boolean;
  v_found boolean;
  v_name text;
  v_old public.distribution_claims%rowtype;
  v_commodity_rate numeric;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only MAO Admin can tag distribution beneficiaries.';
  end if;
  select allocation_per_hectare into v_commodity_rate from public.commodities where commodity_id = p_commodity_id;

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

    select * into v_old from public.distribution_claims
    where event_id = p_event_id and commodity_id = p_commodity_id and farmer_id = v_farmer;
    v_found := found;

    -- A row saved before with the same quantity (and, when the admin chose
    -- "Keep current", the old rate) keeps its farm size, rate and adjustment.
    v_unchanged := v_found and v_old.quantity_received = v_qty
      and (b ->> 'recompute') is distinct from 'true';
    if v_unchanged then
      v_size := coalesce(v_old.farm_size_hectares, public.farmer_farm_size(v_farmer));
      v_rate := v_old.rate_kg_per_ha;
      v_adjusted := v_old.quantity_adjusted;
      v_reason := coalesce(v_reason, v_old.adjustment_reason);
    else
      v_size := public.farmer_farm_size(v_farmer);
      v_rate := v_commodity_rate;
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
      farm_size_hectares, quantity_adjusted, adjustment_reason, rate_kg_per_ha
    ) values (
      p_event_id, p_commodity_id, v_farmer, v_qty,
      coalesce((b ->> 'acknowledgement_status')::public.beneficiary_acknowledgement_status, 'pending'),
      case when (b ->> 'acknowledgement_status') = 'received' then now() else null end,
      nullif(b ->> 'duplicate_override_reason', ''), auth.uid(),
      v_size, v_adjusted, v_reason, v_rate
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
      rate_kg_per_ha = excluded.rate_kg_per_ha;
  end loop;
end;
$$;

-- A commodity change no longer has types to clear: moved rows keep their
-- saved rate until they're recomputed.
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
$$;

-- "Add all eligible farmers": Active farmers enrolled in this commodity's
-- seed program — or, when nobody is enrolled in it, farmers whose crop is
-- the commodity's category. Each with their seed program.
drop function if exists public.distribution_eligible_farmers(bigint, text, integer, bigint);
create function public.distribution_eligible_farmers(
  p_commodity_id bigint,
  p_program_name text,
  p_year integer,
  p_exclude_event_id bigint default null
)
returns table (
  farmer_id bigint, rsbsa_no text, first_name text, surname text, barangay text, sitio_purok text,
  crop_type text, farm_size_hectares numeric, avatar_url text, seed_program_id bigint,
  duplicate_program text, duplicate_date date, duplicate_quantity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with enrolled as (
    select exists (
      select 1 from public.farmers x
      where x.seed_program_id = p_commodity_id and x.deleted_at is null and x.status = 'active'
    ) as any_enrolled
  )
  select f.farmer_id, f.rsbsa_no, f.first_name, f.surname,
         coalesce(addr.barangay, 'Langapud'), addr.street,
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
    and f.deleted_at is null
    and f.status = 'active'
    and case when enrolled.any_enrolled then f.seed_program_id = p_commodity_id
             else lower(btrim(crop.crop_type)) = lower(btrim(c.category)) end
  order by f.surname, f.first_name
$$;

revoke all on function public.distribution_eligible_farmers(bigint, text, integer, bigint) from public, anon;
grant execute on function public.distribution_eligible_farmers(bigint, text, integer, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- save_farmer: the Seed program (optional) instead of a type.
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
  v_program bigint := nullif(p_farmer ->> 'seed_program_id', '')::bigint;
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
  if v_program is not null and not exists (
    select 1 from public.commodities c
    where c.commodity_id = v_program and c.deleted_at is null and c.allocation_per_hectare is not null
      and (p_farmer_id is not null and v_program = (select seed_program_id from public.farmers where farmer_id = p_farmer_id) or c.status = 'active')
  ) then
    raise exception 'Choose a seed program from the list (commodities with a kg-per-hectare allocation).';
  end if;

  if p_farmer_id is null then
    insert into public.farmers (
      rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no, org_affiliation, status, seed_program_id
    ) values (
      btrim(p_farmer ->> 'rsbsa_no'), btrim(p_farmer ->> 'surname'), btrim(p_farmer ->> 'first_name'),
      nullif(btrim(p_farmer ->> 'middle_name'), ''), (p_farmer ->> 'sex')::public.sex_type, v_birth,
      p_farmer ->> 'contact_no', nullif(btrim(p_farmer ->> 'org_affiliation'), ''),
      coalesce(p_farmer ->> 'status', 'active')::public.farmer_status, v_program
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
    status = coalesce(p_farmer ->> 'status', 'active')::public.farmer_status,
    seed_program_id = v_program
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
  return v_id;
end;
$$;

revoke all on function public.save_farmer(bigint, jsonb) from public, anon;
grant execute on function public.save_farmer(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Harvest reports: the crop is a commodity; no type is asked for.
-- ---------------------------------------------------------------------------
create or replace function public.harvest_report_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role public.user_role := public.current_role();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_farm numeric;
  v_commodity record;
  data_fields text[] := array['season', 'season_year', 'commodity_id', 'commodity_type_id', 'area_harvested_ha', 'yield_kg',
    'harvest_date', 'photo_path', 'latitude', 'longitude', 'gps_accuracy_meters', 'photo_captured_at',
    'distribution_claim_id', 'request_id', 'remarks'];
  review_fields text[] := array['status', 'review_remarks'];
  changed text[];
begin
  if v_role = 'farmer' and new.farmer_id is distinct from public.current_farmer_id() then
    raise exception 'You can only report your own harvest.';
  end if;
  -- A signed-in user always starts a Submitted report filed by themselves.
  -- Only the service role (no signed-in user: seed data, maintenance) may
  -- load other values; the harvest rules below still apply to it.
  if tg_op = 'INSERT' and v_role is null then
    new.status := coalesce(new.status, 'submitted');
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
  elsif tg_op = 'INSERT' then
    new.status := 'submitted';
    new.submitted_by := auth.uid();
    new.review_remarks := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.resubmitted_at := null;
    new.created_at := now();
    new.updated_at := now();
    new.deleted_at := null;
  elsif v_role is not null then
    select coalesce(array_agg(key), '{}') into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and key not in ('updated_at', 'yield_per_ha');

    if old.deleted_at is not null then
      raise exception 'This harvest report was removed.';
    end if;
    if 'farmer_id' = any (changed) or 'submitted_by' = any (changed) or 'created_at' = any (changed)
       or 'reviewed_by' = any (changed) or 'reviewed_at' = any (changed) or 'resubmitted_at' = any (changed) then
      raise exception 'Only the harvest details can be changed on a harvest report.';
    end if;
    new.updated_at := now();

    -- Removing (soft): nothing else may change in the same step.
    if new.deleted_at is not null then
      if changed <> array['deleted_at'] then
        raise exception 'Remove the report on its own, without other changes.';
      end if;
      if v_role <> 'mao_admin' and old.status = 'verified' then
        raise exception 'A verified harvest report can''t be removed.';
      end if;
      new.deleted_at := now();
      return new;
    end if;

    if v_role = 'mao_admin' and changed <@ review_fields then
      -- Verify / Return a submitted report.
      if new.status is distinct from old.status then
        if old.status <> 'submitted' then
          raise exception 'This harvest report was already %. Refresh to see its current status.',
            case old.status when 'verified' then 'verified' else 'returned' end;
        end if;
        if new.status = 'submitted' then
          raise exception 'Choose Verify or Return.';
        end if;
        new.review_remarks := nullif(btrim(coalesce(new.review_remarks, '')), '');
        if new.status = 'returned' and new.review_remarks is null then
          raise exception 'Give the farmer a reason for returning the report.';
        end if;
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      elsif 'review_remarks' = any (changed) then
        raise exception 'Remarks are saved together with Verify or Return.';
      end if;
      return new;
    end if;

    -- Editing the details (farmer / the FA President who filed it): only
    -- before verification; a returned report goes back to Submitted.
    if 'review_remarks' = any (changed) or ('status' = any (changed) and not (old.status = 'returned' and new.status = 'submitted')) then
      raise exception 'Only the MAO Admin can verify or return a harvest report.';
    end if;
    if not (changed <@ (data_fields || array['status'])) then
      raise exception 'Only the harvest details can be changed on a harvest report.';
    end if;
    if old.status = 'verified' then
      raise exception 'This harvest report was already verified and can''t be changed.';
    end if;
    if old.status = 'returned' then
      new.status := 'submitted';
      new.resubmitted_at := now();
    end if;
  end if;

  -- The rules (on add and on every edit of the details).
  new.remarks := nullif(btrim(coalesce(new.remarks, '')), '');
  if new.season not in ('wet', 'dry') then
    raise exception 'Choose the season (Wet or Dry).';
  end if;
  if new.season_year < 2000 or new.season_year > extract(year from v_today)::int + 1 then
    raise exception 'Choose a season year from 2000 to %.', extract(year from v_today)::int + 1;
  end if;

  select commodity_id, name, unit, deleted_at into v_commodity from public.commodities where commodity_id = new.commodity_id;
  if not found or (v_commodity.deleted_at is not null and (tg_op = 'INSERT' or new.commodity_id is distinct from old.commodity_id)) then
    raise exception 'That crop is no longer on the list — choose another.';
  end if;
  if new.area_harvested_ha is null or new.area_harvested_ha <= 0 then
    raise exception 'Enter the area harvested in hectares (more than 0).';
  end if;
  v_farm := public.farmer_farm_size(new.farmer_id);
  if v_farm > 0 and new.area_harvested_ha > v_farm then
    raise exception 'The area harvested can''t be more than the farm size (% ha).', to_char(v_farm, 'FM999,990.00');
  end if;
  if new.yield_kg is null or new.yield_kg <= 0 then
    raise exception 'Enter the harvest in kilograms (more than 0).';
  end if;
  if new.harvest_date is null then
    raise exception 'Enter the harvest date.';
  end if;
  if new.harvest_date > v_today then
    raise exception 'The harvest date can''t be in the future.';
  end if;
  if new.harvest_date < date '2000-01-01' then
    raise exception 'Check the harvest date.';
  end if;

  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> new.farmer_id::text then
    raise exception 'That photo doesn''t belong to this farmer.';
  end if;
  if new.latitude is not null and (new.latitude not between -90 and 90 or new.longitude not between -180 and 180) then
    raise exception 'The GPS location isn''t valid. Capture it again.';
  end if;
  if new.distribution_claim_id is not null and not exists (
    select 1 from public.distribution_claims c where c.claim_id = new.distribution_claim_id and c.farmer_id = new.farmer_id
  ) then
    raise exception 'That distribution isn''t one of this farmer''s.';
  end if;
  if new.request_id is not null and not exists (
    select 1 from public.requests r where r.request_id = new.request_id and r.farmer_id = new.farmer_id
  ) then
    raise exception 'That request isn''t one of this farmer''s.';
  end if;
  if not exists (select 1 from public.farmers f where f.farmer_id = new.farmer_id and f.deleted_at is null) then
    raise exception 'That farmer is no longer in the list.';
  end if;
  return new;
end;
$$;

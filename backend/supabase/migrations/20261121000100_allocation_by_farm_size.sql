-- Review suggestion (Nov 2026): a tagged farmer's quantity is computed from
-- their farm size: farm size (ha) × the commodity's allocation per hectare,
-- capped at its maximum per farmer, rounded to 2 decimals. The MAO Admin may
-- change it, but a changed quantity is marked "adjusted" and needs a short
-- reason — checked here, not only in the app, and kept in the audit log.

-- Per tagged farmer: the farm size used, and whether/why the quantity was
-- adjusted. Existing rows keep quantity_adjusted = false.
alter table public.distribution_claims
  add column if not exists farm_size_hectares numeric(10, 2),
  add column if not exists quantity_adjusted boolean not null default false,
  add column if not exists adjustment_reason text;

-- A farmer's total farm size (all parcels). Runs with the caller's rights, so
-- a farmer can only see their own.
create or replace function public.farmer_farm_size(p_farmer_id bigint)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(farm_size_hectares), 0) from public.farm_parcels where farmer_id = p_farmer_id
$$;

-- The computed quantity for a farm size, or null when the commodity has no
-- allocation per hectare.
create or replace function public.commodity_allocation(p_commodity_id bigint, p_farm_size numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when c.allocation_per_hectare is null or p_farm_size is null then null
    else round(least(p_farm_size * c.allocation_per_hectare, coalesce(c.max_per_farmer, p_farm_size * c.allocation_per_hectare)), 2)
  end
  from public.commodities c
  where c.commodity_id = p_commodity_id
$$;

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
  v_size numeric;
  v_computed numeric;
  v_adjusted boolean;
  v_unchanged boolean;
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

    select * into v_old from public.distribution_claims
    where event_id = p_event_id and commodity_id = p_commodity_id and farmer_id = v_farmer;
    -- A row saved before and not changed now keeps what it had (including
    -- rows saved before allocation rates existed).
    v_unchanged := found and v_old.quantity_received = v_qty;
    v_size := case when v_unchanged and v_old.farm_size_hectares is not null
      then v_old.farm_size_hectares else public.farmer_farm_size(v_farmer) end;
    v_computed := public.commodity_allocation(p_commodity_id, v_size);

    if v_unchanged then
      v_adjusted := v_old.quantity_adjusted;
      v_reason := coalesce(v_reason, v_old.adjustment_reason);
    elsif v_computed is not null and v_qty <> v_computed then
      if v_reason is null then
        select first_name || ' ' || surname into v_name from public.farmers where farmer_id = v_farmer;
        raise exception 'Give a short reason for the adjusted quantity of %.', coalesce(v_name, 'a farmer');
      end if;
      v_adjusted := true;
    else
      v_adjusted := false;
      v_reason := null;
    end if;

    insert into public.distribution_claims (
      event_id, commodity_id, farmer_id, quantity_received,
      acknowledgement_status, acknowledged_at, duplicate_override_reason, released_by,
      farm_size_hectares, quantity_adjusted, adjustment_reason
    ) values (
      p_event_id, p_commodity_id, v_farmer, v_qty,
      coalesce((b ->> 'acknowledgement_status')::public.beneficiary_acknowledgement_status, 'pending'),
      case when (b ->> 'acknowledgement_status') = 'received' then now() else null end,
      nullif(b ->> 'duplicate_override_reason', ''), auth.uid(),
      v_size, v_adjusted, v_reason
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
      adjustment_reason = excluded.adjustment_reason;
  end loop;
end;
$$;

-- save_distribution as before, plus: when an edit changes the commodity, the
-- tagged farmers move to the new commodity (they used to stay under the old
-- one and be counted twice).
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

  if p_event_id is null then
    insert into public.distribution_events (program_name, event_date, venue, funding_source, status, beneficiaries_count, barangay)
    values (
      btrim(p_event ->> 'program_name'), coalesce(v_date, v_today), nullif(btrim(p_event ->> 'venue'), ''),
      nullif(btrim(p_event ->> 'funding_source'), ''), coalesce(v_status, 'ongoing'),
      case when v_tagged > 0 then v_tagged else coalesce((p_event ->> 'beneficiaries_count')::int, 0) end,
      coalesce(nullif(btrim(p_event ->> 'barangay'), ''), 'Langapud')
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
      update public.distribution_claims set commodity_id = p_commodity_id
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

-- "Add all eligible farmers": Active farmers whose crop matches the
-- commodity's category, with the farm data the form shows and, when a
-- program is given, the same-commodity/program/year duplicate (if any).
-- MAO Admin only (returns nothing for anyone else).
create or replace function public.distribution_eligible_farmers(
  p_commodity_id bigint,
  p_program_name text,
  p_year integer,
  p_exclude_event_id bigint default null
)
returns table (
  farmer_id bigint, rsbsa_no text, first_name text, surname text, barangay text, sitio_purok text,
  crop_type text, farm_size_hectares numeric, avatar_url text,
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
grant execute on function public.farmer_farm_size(bigint) to authenticated;
grant execute on function public.commodity_allocation(bigint, numeric) to authenticated;

-- Distributions, requests and commodities (Nov 24, 2026).
--
--   * A new distribution always starts Ongoing; the MAO Admin marks it
--     Completed afterwards (from the status badge or Edit). A Completed one
--     can be set back to Ongoing in Edit (the completion date is cleared;
--     farmers are not notified twice — received_notified_at).
--   * The distribution form can use a rate for one distribution only: each
--     row may carry "rate" (kg/ha), used instead of the commodity's rate
--     when the quantity is computed and saved with the row. The commodity
--     keeps its own rate; saved distributions never change.
--   * The Activity Log says who filed a farmer request and for whom
--     ("Request filed by Pedro Lagunay (Farmers' Association President) for
--     Rodel Bagas: 22.5 kg of Rice Seeds – Hybrid").
--   * Association requests are no longer used by the apps; the table stays.

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
      -- A rate chosen for this distribution only (the commodity's own rate
      -- unchanged), else the commodity's rate.
      v_rate := coalesce(nullif(b ->> 'rate', '')::numeric, v_commodity_rate);
      if v_rate is not null and (v_rate <= 0 or v_rate > 1000) then
        raise exception 'Enter a rate above 0 and up to 1,000 kg per hectare.';
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
    (new_data ->> 'farmer_id'), (old_data ->> 'farmer_id')
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

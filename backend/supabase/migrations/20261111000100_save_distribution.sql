-- Error-handling fix (Nov 2026): a distribution (event + item + tagged
-- farmers) is saved in one transaction, so a dropped connection or a failing
-- step can't leave a distribution without its item or farmers. It also
-- repeats the form's rules on the server.
--
-- Messages raised here (RAISE EXCEPTION, SQLSTATE P0001) are shown to the
-- user as written — see friendlyError in web/src/lib and mobile/src/lib.
--
-- save_distribution(p_event_id, p_event, p_item_id, p_commodity_id,
--                   p_quantity, p_beneficiaries)
-- p_event_id null = new distribution (dated today in Manila unless
-- p_event.event_date is given). p_event keys: program_name, venue,
-- funding_source, status, event_date, barangay, beneficiaries_count (used
-- only when no farmers are tagged). p_beneficiaries: the full list of tagged
-- farmers [{farmer_id, quantity_received, duplicate_override_reason}] — an
-- empty list removes every tagged farmer; null leaves them unchanged.
-- Same write order as before (event, item, farmers), so the notification
-- triggers behave as they did. Returns the event_id.
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
    update public.distribution_event_items set commodity_id = p_commodity_id, quantity_allocated = v_total
    where event_item_id = p_item_id and event_id = v_id;
    if not found then
      raise exception 'That distribution item no longer exists — refresh and try again.';
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

revoke all on function public.save_distribution(bigint, jsonb, bigint, bigint, numeric, jsonb) from public, anon;
grant execute on function public.save_distribution(bigint, jsonb, bigint, bigint, numeric, jsonb) to authenticated;

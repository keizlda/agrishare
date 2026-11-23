-- Only farmers create harvest reports (Nov 24, 2026).
--
-- Harvest reports are submitted by farmers from the mobile app. The MAO
-- Admin still verifies or returns them (and may correct or remove one); the
-- Farmers' Association President can still correct the reports they filed
-- earlier, before verification. Adding a report for a farmer from the web is
-- no longer allowed:
--   * the insert policy is the farmer's own report only;
--   * the harvest-photos upload policy is the farmer's own folder only;
--   * the guard says so in plain words when a staff account tries.

drop policy if exists "harvest reports: farmer adds own, staff add for a farmer" on public.harvest_reports;
drop policy if exists "harvest reports: farmer adds own" on public.harvest_reports;
create policy "harvest reports: farmer adds own" on public.harvest_reports
  for insert to authenticated
  with check (
    status = 'submitted'
    and public.current_role() = 'farmer'
    and farmer_id = public.current_farmer_id()
  );

drop policy if exists "harvest photos: farmer uploads own, staff upload for a farmer" on storage.objects;
drop policy if exists "harvest photos: farmer uploads own" on storage.objects;
create policy "harvest photos: farmer uploads own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'harvest-photos'
    and public.current_role() = 'farmer'
    and (storage.foldername(name))[1] = public.current_farmer_id()::text
  );

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
  -- Only farmers report harvests (from the mobile app); staff verify or
  -- return them. The service role (seed data, maintenance) is not a user.
  if tg_op = 'INSERT' and v_role is not null and v_role <> 'farmer' then
    raise exception 'Harvest reports are submitted by farmers from the mobile app.';
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

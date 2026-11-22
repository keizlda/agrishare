-- MAO presentation (Nov 22, 2026), Phase 4: harvest reporting, in kilograms.
--
-- A farmer reports a harvest from the mobile app (season, crop and type,
-- area harvested, yield in kg, harvest date, optional geotagged photo).
-- The Farmers' Association President can add one on a farmer's behalf. The
-- MAO Admin verifies it or returns it with remarks; a returned report can be
-- corrected and resubmitted.
--
-- Who may do what (RLS + the guard trigger below):
--   Farmer: reads and adds their own; edits/resubmits or removes their own
--           while Submitted or Returned.
--   Farmers' Association President: reads all; adds for any farmer; edits
--           or removes the ones they filed while Submitted or Returned.
--   MAO Admin: reads all; adds for any farmer; Verify / Return (remarks
--           required to return); removes any.

create type public.harvest_report_status as enum ('submitted', 'verified', 'returned');

create table public.harvest_reports (
  harvest_report_id bigint generated always as identity primary key,
  farmer_id bigint not null references public.farmers (farmer_id),
  season text not null,
  season_year integer not null,
  commodity_id bigint not null references public.commodities (commodity_id),
  commodity_type_id bigint references public.commodity_types (commodity_type_id),
  area_harvested_ha numeric(10, 2) not null,
  yield_kg numeric(12, 2) not null,
  yield_per_ha numeric(12, 2) generated always as (round(yield_kg / nullif(area_harvested_ha, 0), 2)) stored,
  harvest_date date not null,
  photo_path text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  gps_accuracy_meters numeric(8, 1),
  photo_captured_at timestamptz,
  distribution_claim_id bigint references public.distribution_claims (claim_id),
  request_id bigint references public.requests (request_id),
  remarks text,
  status public.harvest_report_status not null default 'submitted',
  review_remarks text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  submitted_by uuid default auth.uid() references public.profiles (id),
  resubmitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint harvest_reports_season check (season in ('wet', 'dry')),
  constraint harvest_reports_year check (season_year between 2000 and 2100),
  constraint harvest_reports_area check (area_harvested_ha > 0 and area_harvested_ha <= 1000),
  constraint harvest_reports_yield check (yield_kg > 0 and yield_kg <= 10000000),
  constraint harvest_reports_remarks_length check (remarks is null or char_length(remarks) <= 500),
  constraint harvest_reports_review_remarks_length check (review_remarks is null or char_length(review_remarks) <= 500),
  constraint harvest_reports_gps check ((latitude is null) = (longitude is null))
);

create index harvest_reports_farmer_idx on public.harvest_reports (farmer_id) where deleted_at is null;
create index harvest_reports_status_idx on public.harvest_reports (status) where deleted_at is null;

comment on table public.harvest_reports is 'Harvests reported by farmers (or for them by the Farmers'' Association President), in kilograms; verified or returned by the MAO Admin.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.harvest_reports enable row level security;
revoke all on public.harvest_reports from anon;
grant select, insert, update on public.harvest_reports to authenticated;

create policy "harvest reports: staff read all, farmer reads own"
  on public.harvest_reports for select to authenticated
  using (public.is_staff() or farmer_id = public.current_farmer_id());

create policy "harvest reports: farmer adds own, staff add for a farmer"
  on public.harvest_reports for insert to authenticated
  with check (
    status = 'submitted'
    and (
      farmer_id = public.current_farmer_id()
      or public.current_role() in ('fa_president', 'mao_admin')
    )
  );

create policy "harvest reports: farmer edits own before verification"
  on public.harvest_reports for update to authenticated
  using (farmer_id = public.current_farmer_id() and status in ('submitted', 'returned') and deleted_at is null)
  with check (farmer_id = public.current_farmer_id() and status in ('submitted', 'returned'));

create policy "harvest reports: FA President edits own filings before verification"
  on public.harvest_reports for update to authenticated
  using (public.current_role() = 'fa_president' and submitted_by = auth.uid() and status in ('submitted', 'returned') and deleted_at is null)
  with check (public.current_role() = 'fa_president' and submitted_by = auth.uid() and status in ('submitted', 'returned'));

create policy "harvest reports: MAO reviews"
  on public.harvest_reports for update to authenticated
  using (public.current_role() = 'mao_admin' and deleted_at is null)
  with check (public.current_role() = 'mao_admin');

-- No delete policy: removing sets deleted_at, so the record stays.

-- ---------------------------------------------------------------------------
-- Guard: who may change which fields, the rules, and the stamps.
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
  v_type record;
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
  if tg_op = 'INSERT' then
    new.status := 'submitted';
    new.submitted_by := auth.uid();
    new.review_remarks := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.resubmitted_at := null;
    new.created_at := now();
    new.updated_at := now();
    new.deleted_at := null;
  else
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
  if new.commodity_type_id is null then
    if exists (select 1 from public.commodity_types t where t.commodity_id = new.commodity_id and t.deleted_at is null) then
      raise exception 'Choose the program / type for %.', v_commodity.name;
    end if;
  else
    select commodity_id, deleted_at into v_type from public.commodity_types where commodity_type_id = new.commodity_type_id;
    if not found or v_type.commodity_id <> new.commodity_id then
      raise exception 'That type doesn''t belong to the chosen crop.';
    end if;
    if v_type.deleted_at is not null and (tg_op = 'INSERT' or new.commodity_type_id is distinct from old.commodity_type_id) then
      raise exception 'That type was removed — choose another type.';
    end if;
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

create trigger harvest_report_guard before insert or update on public.harvest_reports
  for each row execute function public.harvest_report_guard();

create trigger audit_harvest_reports after insert or update on public.harvest_reports
  for each row execute function public.log_audit_event();

-- ---------------------------------------------------------------------------
-- Notifications
--   Farmer adds or resubmits  → MAO Admin + Farmers' Association President.
--   FA President adds          → MAO Admin + the farmer.
--   MAO Admin adds             → the farmer.
--   Verified / Returned        → the farmer (+ the FA President who filed it).
-- ---------------------------------------------------------------------------
alter table public.user_notifications drop constraint if exists user_notifications_type_check;
alter table public.user_notifications add constraint user_notifications_type_check
  check (type = any (array['validated', 'rejected', 'validation', 'request', 'distribution', 'announcement', 'system', 'harvest']));

create or replace function public.notify_harvest_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer record;
  v_role public.user_role;
  v_what text;
  v_link text := '/harvest?id=' || new.harvest_report_id;
begin
  select f.profile_id, btrim(f.first_name || ' ' || f.surname) as name into v_farmer from public.farmers f where f.farmer_id = new.farmer_id;
  select role into v_role from public.profiles where id = auth.uid();
  v_what := rtrim(rtrim(to_char(new.yield_kg, 'FM999,999,990.00'), '0'), '.') || ' kg of ' || coalesce((select name from public.commodities where commodity_id = new.commodity_id), 'crop')
    || coalesce(' · ' || (select name from public.commodity_types where commodity_type_id = new.commodity_type_id), '')
    || ' (' || initcap(new.season) || ' season ' || new.season_year || ')';

  if tg_op = 'INSERT' then
    if v_role = 'farmer' then
      perform public.notify_role('mao_admin', 'harvest', 'New harvest report', v_farmer.name || ' reported ' || v_what || '.', v_link);
      perform public.notify_role('fa_president', 'harvest', 'New harvest report', v_farmer.name || ' reported ' || v_what || '.', v_link);
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
$$;

revoke execute on function public.notify_harvest_report_change() from public, anon, authenticated;

create trigger notify_harvest_report_change after insert or update on public.harvest_reports
  for each row execute function public.notify_harvest_report_change();

-- ---------------------------------------------------------------------------
-- Photos: a private bucket (JPG/PNG/WebP, up to 10 MB). Path:
-- {farmer id}/{random}.jpg. Farmers upload to and read their own folder; the
-- Farmers' Association President and the MAO Admin upload for any farmer and
-- read all.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('harvest-photos', 'harvest-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "harvest photos: farmer uploads own, staff upload for a farmer"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'harvest-photos'
    and (
      (storage.foldername(name))[1] = public.current_farmer_id()::text
      or (
        public.current_role() in ('fa_president', 'mao_admin')
        and exists (select 1 from public.farmers f where f.farmer_id::text = (storage.foldername(name))[1] and f.deleted_at is null)
      )
    )
  );

create policy "harvest photos: farmer reads own, staff read all"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'harvest-photos'
    and (public.is_staff() or (storage.foldername(name))[1] = public.current_farmer_id()::text)
  );

-- ---------------------------------------------------------------------------
-- Summary for the Harvest page and Dashboard (respects RLS: security invoker).
-- ---------------------------------------------------------------------------
create or replace view public.harvest_report_summary
with (security_invoker = true) as
select
  count(*)::int as reports,
  coalesce(sum(yield_kg), 0) as total_kg,
  coalesce(sum(area_harvested_ha), 0) as total_ha,
  count(*) filter (where status = 'submitted')::int as submitted,
  count(*) filter (where status = 'verified')::int as verified,
  count(*) filter (where status = 'returned')::int as returned
from public.harvest_reports
where deleted_at is null;

grant select on public.harvest_report_summary to authenticated;

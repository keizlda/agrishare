-- Approved instead of Validated/Verified, one Farmers' Association President
-- per barangay (a farmer can be made the president), and distribution
-- schedule posts for a distribution's farmers (Nov 27, 2026).
--
-- * Reviews: proof of planting and harvest reports both go Pending →
--   Approved or Rejected. The enum values are renamed (existing records
--   follow): crop_validation_status validated → approved;
--   harvest_report_status verified → approved, submitted → pending.
-- * Farmers' Association Presidents: one per barangay. Whenever an account
--   becomes a barangay's president (made from a farmer, created with an
--   email, or moved), the barangay's previous president goes back to being a
--   farmer; one who isn't a farmer is signed out for good.
--   promote_farmer_to_fa_president makes a farmer (with a login) the
--   president of their barangay: the same login, now only a president (the
--   farmer record stays, for history; they no longer use the farmer app).
-- * Announcements: a post can be a distribution's schedule
--   (linked_distribution_id) and go to chosen farmers only
--   (target_farmer_ids; by default the distribution's tagged farmers). Only
--   those farmers (and the barangay's Farmers' Association President) see it
--   and are notified.

-- ---------------------------------------------------------------------------
-- Reviews: Pending / Approved / Rejected
-- ---------------------------------------------------------------------------
alter type public.crop_validation_status rename value 'validated' to 'approved';
alter type public.harvest_report_status rename value 'verified' to 'approved';
alter type public.harvest_report_status rename value 'submitted' to 'pending';
alter view public.harvest_report_summary rename column submitted to pending;
alter view public.harvest_report_summary rename column verified to approved;

-- Notification types: "approved" is added ("validated" stays allowed for older rows).
alter table public.user_notifications drop constraint user_notifications_type_check;
alter table public.user_notifications add constraint user_notifications_type_check
  check (type = any (array['approved', 'validated', 'rejected', 'validation', 'request', 'distribution', 'announcement', 'system', 'harvest']));

-- Earlier notifications use the new words too.
update public.user_notifications set
  type = 'approved',
  title = 'Your proof of planting was approved',
  message = replace(message, 'The Agriculture Office validated your proof of planting.', 'The Agriculture Office approved your proof of planting.')
where type = 'validated';
update public.user_notifications set
  title = replace(replace(title, 'Your crop validation was rejected', 'Your proof of planting was rejected'), 'Harvest report verified', 'Harvest report approved'),
  message = replace(replace(replace(message, 'was verified by the MAO', 'was approved by the MAO'), ') was verified.', ') was approved.'), 'The MAO will verify it.', 'The MAO will review it.')
where type in ('harvest', 'rejected');

create or replace function public.notify_crop_validation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  farmer_name text;
  farmer_profile uuid;
  preview text;
begin
  select first_name || ' ' || surname, profile_id
    into farmer_name, farmer_profile
    from public.farmers where farmer_id = new.farmer_id;

  if tg_op = 'INSERT' then
    perform public.notify_role(
      'mao_admin', 'validation', 'New proof of planting',
      coalesce(farmer_name, 'A farmer') || ' submitted proof of planting for review.',
      '/validation/planting/' || new.validation_id
    );
  elsif tg_op = 'UPDATE'
        and old.status = 'pending'
        and new.status in ('approved', 'rejected') then
    preview := case
      when nullif(btrim(coalesce(new.remarks, '')), '') is null then null
      when length(new.remarks) > 120 then left(new.remarks, 117) || '...'
      else new.remarks
    end;
    if new.status = 'approved' then
      perform public.notify_user(
        farmer_profile, 'approved', 'Your proof of planting was approved',
        coalesce(preview, 'The Agriculture Office approved your proof of planting.'),
        '/validation/planting/' || new.validation_id
      );
    else
      perform public.notify_user(
        farmer_profile, 'rejected', 'Your proof of planting was rejected',
        coalesce('Reason: ' || preview, 'Open the app to see the reason and resubmit.'),
        '/validation/planting/' || new.validation_id
      );
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.notify_harvest_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
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
        'Your harvest of ' || v_what || ' was reported for you. The MAO will review it.', v_link);
    end if;
    return new;
  end if;

  if new.deleted_at is not null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform public.notify_user(v_farmer.profile_id, 'harvest', 'Harvest report approved',
      'Your harvest report of ' || v_what || ' was approved by the MAO.' || coalesce(' Remarks: ' || new.review_remarks, ''), v_link);
    if new.submitted_by is distinct from v_farmer.profile_id then
      perform public.notify_user(new.submitted_by, 'harvest', 'Harvest report approved',
        'The harvest report for ' || v_farmer.name || ' (' || v_what || ') was approved.', v_link);
    end if;
  elsif new.status = 'rejected' then
    perform public.notify_user(v_farmer.profile_id, 'harvest', 'Harvest report rejected',
      'The MAO rejected your harvest report of ' || v_what || '. Remarks: ' || coalesce(new.review_remarks, '') || ' Correct it and resubmit.', v_link);
    if new.submitted_by is distinct from v_farmer.profile_id then
      perform public.notify_user(new.submitted_by, 'harvest', 'Harvest report rejected',
        'The harvest report for ' || v_farmer.name || ' was rejected. Remarks: ' || coalesce(new.review_remarks, ''), v_link);
    end if;
  elsif new.status = 'pending' and old.status = 'rejected' then
    perform public.notify_role('mao_admin', 'harvest', 'Harvest report resubmitted', v_farmer.name || '''s harvest report of ' || v_what || ' was corrected and resubmitted.', v_link);
  end if;
  return new;
end;
$function$;

create or replace function public.harvest_report_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
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
  -- Only farmers report harvests (from the mobile app); staff approve or
  -- reject them. The service role (seed data, maintenance) is not a user.
  if tg_op = 'INSERT' and v_role is not null and v_role <> 'farmer' then
    raise exception 'Harvest reports are submitted by farmers from the mobile app.';
  end if;
  -- A signed-in user always starts a Pending report filed by themselves.
  -- Only the service role (no signed-in user: seed data, maintenance) may
  -- load other values; the harvest rules below still apply to it.
  if tg_op = 'INSERT' and v_role is null then
    new.status := coalesce(new.status, 'pending');
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
  elsif tg_op = 'INSERT' then
    new.status := 'pending';
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
      if v_role <> 'mao_admin' and old.status = 'approved' then
        raise exception 'An approved harvest report can''t be removed.';
      end if;
      new.deleted_at := now();
      return new;
    end if;

    if v_role = 'mao_admin' and changed <@ review_fields then
      -- Approve / Reject a pending report.
      if new.status is distinct from old.status then
        if old.status <> 'pending' then
          raise exception 'This harvest report was already %. Refresh to see its current status.',
            case old.status when 'approved' then 'approved' else 'rejected' end;
        end if;
        if new.status = 'pending' then
          raise exception 'Choose Approve or Reject.';
        end if;
        new.review_remarks := nullif(btrim(coalesce(new.review_remarks, '')), '');
        if new.status = 'rejected' and new.review_remarks is null then
          raise exception 'Give the farmer a reason for rejecting the report.';
        end if;
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      elsif 'review_remarks' = any (changed) then
        raise exception 'Remarks are saved together with Approve or Reject.';
      end if;
      return new;
    end if;

    -- Editing the details (farmer / the FA President who filed it): only
    -- before approval; a rejected report goes back to Pending.
    if 'review_remarks' = any (changed) or ('status' = any (changed) and not (old.status = 'rejected' and new.status = 'pending')) then
      raise exception 'Only the MAO Admin can approve or reject a harvest report.';
    end if;
    if not (changed <@ (data_fields || array['status'])) then
      raise exception 'Only the harvest details can be changed on a harvest report.';
    end if;
    if old.status = 'approved' then
      raise exception 'This harvest report was already approved and can''t be changed.';
    end if;
    if old.status = 'rejected' then
      new.status := 'pending';
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
$function$;

-- ---------------------------------------------------------------------------
-- Farmers' Association Presidents: one per barangay
-- ---------------------------------------------------------------------------
-- Takes an account off its barangay's presidency: back to farmer when the
-- person has a farmer record, otherwise signed out for good. (Internal.)
create or replace function public.step_down_fa_president(p_user uuid, p_replaced_by text, p_barangay bigint)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
  v_is_farmer boolean;
  v_brgy text;
begin
  select full_name into v_name from public.profiles where id = p_user;
  select exists (select 1 from public.farmers f where f.profile_id = p_user and f.deleted_at is null) into v_is_farmer;
  select name into v_brgy from public.barangays where id = p_barangay;
  -- The role lives in app_metadata (server-only); the profile follows it.
  update auth.users
  set raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - 'barangay_id') || jsonb_build_object('role', 'farmer'),
      banned_until = case when v_is_farmer then banned_until else now() + interval '200 years' end
  where id = p_user;
  update public.profiles set role = 'farmer', barangay_id = null where id = p_user;
  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details, barangay_id)
  values (auth.uid(), public.current_role(), 'profiles', 'update', p_user::text,
          coalesce(nullif(v_name, ''), 'The account') || ' is no longer the Farmers'' Association President of Barangay ' || coalesce(v_brgy, '')
            || ' (replaced by ' || coalesce(nullif(p_replaced_by, ''), 'another account') || ')'
            || case when v_is_farmer then '; back to farmer' else '; account turned off' end,
          jsonb_build_object('old', jsonb_build_object('role', 'fa_president', 'barangay_id', p_barangay), 'new', jsonb_build_object('role', 'farmer')),
          jsonb_build_object('id', p_user), p_barangay);
end;
$function$;
revoke execute on function public.step_down_fa_president(uuid, text, bigint) from anon, public, authenticated;

-- Whenever an account becomes a barangay's president (created, promoted or
-- moved), the barangay's other president steps down.
create or replace function public.one_fa_president_per_barangay()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_other record;
begin
  if new.role <> 'fa_president' or new.barangay_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role = 'fa_president' and old.barangay_id is not distinct from new.barangay_id then
    return new;
  end if;
  for v_other in
    select id from public.profiles
    where role = 'fa_president' and barangay_id = new.barangay_id and id <> new.id
  loop
    perform public.step_down_fa_president(v_other.id, new.full_name, new.barangay_id);
  end loop;
  return new;
end;
$function$;
drop trigger if exists one_fa_president_per_barangay on public.profiles;
create trigger one_fa_president_per_barangay
  after insert or update of role, barangay_id on public.profiles
  for each row
  when (new.role = 'fa_president')
  execute function public.one_fa_president_per_barangay();

-- MAO Admin: make a farmer the Farmers' Association President of their
-- barangay. Same login (the last 6 digits of the RSBSA number), now only a
-- president: the web system instead of the farmer app.
create or replace function public.promote_farmer_to_fa_president(p_farmer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_farmer record;
  v_brgy bigint;
  v_brgy_name text;
  v_before text;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can choose a Farmers'' Association President.';
  end if;
  select f.farmer_id, f.profile_id, f.rsbsa_no, f.status, btrim(f.first_name || ' ' || f.surname) as name, p.role
    into v_farmer
  from public.farmers f left join public.profiles p on p.id = f.profile_id
  where f.farmer_id = p_farmer_id and f.deleted_at is null;
  if not found then
    raise exception 'That farmer is no longer in the list.';
  end if;
  if v_farmer.profile_id is null then
    raise exception 'This farmer has no login yet. Check their RSBSA number, then try again.';
  end if;
  if v_farmer.status <> 'active' then
    raise exception 'Only an Active farmer can be made the Farmers'' Association President.';
  end if;
  if v_farmer.role = 'fa_president' then
    raise exception '% is already a Farmers'' Association President.', v_farmer.name;
  end if;
  v_brgy := public.farmer_barangay_id(p_farmer_id);
  select name into v_brgy_name from public.barangays where id = v_brgy and is_active;
  if v_brgy_name is null then
    raise exception 'Set this farmer''s barangay first.';
  end if;
  select string_agg(full_name, ', ') into v_before from public.profiles where role = 'fa_president' and barangay_id = v_brgy;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'fa_president', 'barangay_id', v_brgy)
  where id = v_farmer.profile_id;
  update public.profiles set role = 'fa_president', barangay_id = v_brgy where id = v_farmer.profile_id;

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details, barangay_id)
  values (auth.uid(), 'mao_admin', 'profiles', 'update', v_farmer.profile_id::text,
          v_farmer.name || ' was made the Farmers'' Association President of Barangay ' || v_brgy_name,
          jsonb_build_object('old', jsonb_build_object('role', 'farmer'), 'new', jsonb_build_object('role', 'fa_president', 'barangay_id', v_brgy)),
          jsonb_build_object('id', v_farmer.profile_id, 'farmer_id', p_farmer_id), v_brgy);
  perform public.notify_user(v_farmer.profile_id, 'system', 'You are now the Farmers'' Association President',
    'You are the Farmers'' Association President of Barangay ' || v_brgy_name || '. Sign in on the AgriShare website with your login ID and password.', '/');

  return jsonb_build_object('name', v_farmer.name, 'barangay', v_brgy_name,
    'login_id', right(regexp_replace(v_farmer.rsbsa_no, '\D', '', 'g'), 6), 'replaced', v_before);
end;
$function$;
revoke execute on function public.promote_farmer_to_fa_president(bigint) from anon, public;
grant execute on function public.promote_farmer_to_fa_president(bigint) to authenticated;

-- Settings → Farmers' Association Presidents: a president made from a
-- farmer signs in with their login ID (shown instead of an email).
drop function if exists public.list_fa_presidents();
create function public.list_fa_presidents()
returns table(id uuid, full_name text, email text, contact_no text, barangay_id bigint, created_at timestamptz, login_id text, farmer_id bigint)
language sql
stable security definer
set search_path = public
as $function$
  select p.id, p.full_name, u.email::text, p.contact_no, p.barangay_id, p.created_at,
         case when f.farmer_id is not null then right(regexp_replace(f.rsbsa_no, '\D', '', 'g'), 6) end,
         f.farmer_id
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.farmers f on f.profile_id = p.id and f.deleted_at is null
  where p.role = 'fa_president' and public.current_role() = 'mao_admin'
  order by p.full_name
$function$;
revoke execute on function public.list_fa_presidents() from anon, public;
grant execute on function public.list_fa_presidents() to authenticated;

-- A Farmers' Association President isn't tagged as a farmer by type.
create or replace function public.farmers_of_type(
  p_farmer_type_id bigint,
  p_barangay_id bigint,
  p_commodity_id bigint default null,
  p_program_name text default null,
  p_year integer default null,
  p_exclude_event_id bigint default null
)
returns table(farmer_id bigint, rsbsa_no text, first_name text, surname text, barangay text, sitio_purok text,
              farm_size_hectares numeric, avatar_url text, duplicate_program text, duplicate_date date, duplicate_quantity numeric)
language sql
stable security definer
set search_path = public
as $function$
  select f.farmer_id, f.rsbsa_no, f.first_name, f.surname, coalesce(addr.barangay, ''), addr.street,
         public.farmer_farm_size(f.farmer_id), p.avatar_url,
         dup.program_name, dup.event_date, dup.quantity_received
  from public.farmers f
  join public.farmer_farmer_types t on t.farmer_id = f.farmer_id and t.farmer_type_id = p_farmer_type_id
  left join lateral (
    select a.barangay, a.street from public.addresses a where a.farmer_id = f.farmer_id order by a.address_id limit 1
  ) addr on true
  left join public.profiles p on p.id = f.profile_id
  left join lateral (
    select * from public.find_duplicate_distribution(f.farmer_id, p_commodity_id, p_program_name, coalesce(p_year, extract(year from now())::int), p_exclude_event_id)
  ) dup on p_commodity_id is not null and nullif(btrim(coalesce(p_program_name, '')), '') is not null
  where public.current_role() = 'mao_admin'
    and f.deleted_at is null
    and f.status = 'active'
    and p.role is distinct from 'fa_president'
    and (p_barangay_id is null or public.farmer_barangay_id(f.farmer_id) = p_barangay_id)
  order by f.surname, f.first_name
$function$;

-- ---------------------------------------------------------------------------
-- Distribution schedule posts, for chosen farmers
-- ---------------------------------------------------------------------------
alter table public.announcements add column target_farmer_ids bigint[];

create or replace function public.announcements_before_write()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_event record;
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

  -- A distribution's schedule: in that distribution's barangay, for its
  -- farmers (and the barangay's Farmers' Association President).
  if new.linked_distribution_id is not null then
    select event_id, barangay_id, is_deleted into v_event from public.distribution_events where event_id = new.linked_distribution_id;
    if not found or v_event.is_deleted then
      raise exception 'That distribution is no longer on the list.';
    end if;
    if v_event.barangay_id is null then
      raise exception 'Set the distribution''s barangay first.';
    end if;
    new.all_barangays := false;
    new.barangay_ids := array[v_event.barangay_id];
    if new.audience = 'fa_president' then
      new.audience := 'everyone';
    end if;
  end if;

  -- Chosen farmers: at least one, each a farmer on the list.
  if new.target_farmer_ids is not null then
    new.target_farmer_ids := array(select distinct x from unnest(new.target_farmer_ids) x where x is not null order by x);
    if cardinality(new.target_farmer_ids) = 0 then
      raise exception 'Choose at least one farmer.';
    end if;
    if exists (select 1 from unnest(new.target_farmer_ids) x left join public.farmers f on f.farmer_id = x where f.farmer_id is null) then
      raise exception 'Choose the farmers from the list.';
    end if;
    if new.audience = 'fa_president' then
      raise exception 'Chosen farmers need a post for farmers.';
    end if;
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
$function$;

-- Who is notified: farmers (only the chosen ones, when there are) and/or
-- Farmers' Association Presidents, in the post's barangays.
drop function if exists public.notify_post_audience(text, boolean, bigint[], boolean, boolean);
create function public.notify_post_audience(p_title text, p_all boolean, p_barangays bigint[], p_farmers boolean, p_fa boolean, p_farmer_ids bigint[])
returns void
language sql
security definer
set search_path = public
as $function$
  insert into public.user_notifications (user_id, type, title, message, link)
  select p.id, 'announcement', 'MAO Labangan posted an announcement', public.post_first_line(p_title), '/announcements'
  from public.profiles p
  where ((p_farmers and p.role = 'farmer'
           and (p_farmer_ids is null or exists (select 1 from public.farmers f where f.profile_id = p.id and f.farmer_id = any (p_farmer_ids))))
         or (p_fa and p.role = 'fa_president'))
    and (p_all or public.user_barangay_id(p.id) = any (p_barangays))
$function$;
revoke execute on function public.notify_post_audience(text, boolean, bigint[], boolean, boolean, bigint[]) from anon, public, authenticated;

create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status = 'published' and new.deleted_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.notify_post_audience(new.title, new.all_barangays, new.barangay_ids,
      new.audience in ('farmers', 'everyone'), new.audience in ('fa_president', 'everyone'), new.target_farmer_ids);
  end if;
  return new;
end;
$function$;

-- Farmers see posts for farmers in their barangay (or all barangays) — and
-- a post for chosen farmers only when they are one of them.
drop policy if exists "announcements: audience reads published" on public.announcements;
create policy "announcements: audience reads published" on public.announcements
  for select to authenticated
  using (
    status = 'published' and deleted_at is null
    and (
      (audience in ('farmers', 'everyone') and (select public.current_role()) = 'farmer'
        and (target_farmer_ids is null or (select public.current_farmer_id()) = any (target_farmer_ids)))
      or (audience in ('fa_president', 'everyone') and (select public.current_role()) = 'fa_president')
    )
    and (all_barangays or (select public.my_barangay_id()) = any (barangay_ids))
  );

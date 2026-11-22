-- Validation inbox (Nov 22, 2026): notifications open the submission's own
-- page — /validation/planting/:id and /validation/harvest/:id — instead of
-- the list. Only the links change. (Older notifications keep their links;
-- the web app redirects /harvest?id=N and /validation to the inbox.)

create or replace function public.notify_crop_validation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      'mao_admin', 'validation', 'New crop validation submitted',
      coalesce(farmer_name, 'A farmer') || ' submitted proof of planting for review.',
      '/validation/planting/' || new.validation_id
    );
  elsif tg_op = 'UPDATE'
        and old.status = 'pending'
        and new.status in ('validated', 'rejected') then
    preview := case
      when nullif(btrim(coalesce(new.remarks, '')), '') is null then null
      when length(new.remarks) > 120 then left(new.remarks, 117) || '...'
      else new.remarks
    end;
    if new.status = 'validated' then
      perform public.notify_user(
        farmer_profile, 'validated', 'Your crop validation was approved',
        coalesce(preview, 'The Agriculture Office validated your proof of planting.'),
        '/validation/planting/' || new.validation_id
      );
    else
      perform public.notify_user(
        farmer_profile, 'rejected', 'Your crop validation was rejected',
        coalesce('Reason: ' || preview, 'Open the app to see the reason and resubmit.'),
        '/validation/planting/' || new.validation_id
      );
    end if;
  end if;
  return new;
end;
$$;

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
  v_link text := '/validation/harvest/' || new.harvest_report_id;
begin
  select f.profile_id, btrim(f.first_name || ' ' || f.surname) as name into v_farmer from public.farmers f where f.farmer_id = new.farmer_id;
  -- Who filed it (the farmer, the Farmers' Association President or the
  -- MAO Admin) decides who is told about a new report.
  select role into v_role from public.profiles where id = coalesce(new.submitted_by, auth.uid());
  v_what := rtrim(rtrim(to_char(new.yield_kg, 'FM999,999,990.00'), '0'), '.') || ' kg of ' || coalesce((select name from public.commodities where commodity_id = new.commodity_id), 'crop')
    || coalesce(' · ' || (select name from public.commodity_types where commodity_type_id = new.commodity_type_id), '')
    || ' (' || initcap(new.season) || ' season ' || new.season_year || ')';

  if tg_op = 'INSERT' then
    if v_role is null or v_role = 'farmer' then
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

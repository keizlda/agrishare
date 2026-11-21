-- Review suggestion (Nov 2026): the Farmers' Association President can file
-- a commodity request for a farmer (e.g. one without a phone). Such a
-- request records who filed it (filed_by) and skips the endorsement step —
-- the Farmers' Association President is the one endorsing — so it goes
-- straight to the MAO as Endorsed. The farmer is notified and sees it in
-- their request history tagged "Filed by Farmers' Association President".

alter table public.requests
  add column if not exists filed_by uuid references public.profiles (id);

comment on column public.requests.filed_by is 'The Farmers'' Association President who filed this request for the farmer (null when the farmer filed it).';

-- The Farmers' Association President may insert a request for any (not
-- removed) farmer, as their own filing. What it becomes is set by
-- request_insert_defaults below.
drop policy if exists "requests: FA President files for a farmer" on public.requests;
create policy "requests: FA President files for a farmer"
  on public.requests for insert to authenticated
  with check (
    public.current_role() = 'fa_president'
    and filed_by = auth.uid()
    and status = 'forwarded'
    and exists (select 1 from public.farmers f where f.farmer_id = requests.farmer_id and f.deleted_at is null)
  );

-- New requests: a farmer's always starts Pending (as before); one filed by
-- the Farmers' Association President is Endorsed by them, now, and goes to
-- the MAO. Nothing else about the decision can be set by whoever inserts.
create or replace function public.request_insert_defaults()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
begin
  if r = 'farmer' then
    new.status := 'pending';
    new.filed_by := null;
    new.fa_remarks := null;
    new.mao_remarks := null;
    new.reviewed_by_fa := null;
    new.reviewed_by_mao := null;
    new.fa_decision_at := null;
    new.forwarded_to_admin_at := null;
    new.admin_decision_at := null;
  elsif r = 'fa_president' then
    new.status := 'forwarded';
    new.filed_by := auth.uid();
    new.reviewed_by_fa := auth.uid();
    new.fa_decision_at := now();
    new.forwarded_to_admin_at := now();
    new.fa_remarks := nullif(btrim(coalesce(new.fa_remarks, '')), '');
    new.mao_remarks := null;
    new.reviewed_by_mao := null;
    new.admin_decision_at := null;
    new.created_at := now();
  end if;
  return new;
end;
$$;

-- Notifications, as before, plus: a request filed by the Farmers'
-- Association President tells the MAO it's waiting for approval and tells
-- the farmer it was filed for them.
create or replace function public.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  farmer_name text;
  commodity_name text;
begin
  select f.profile_id, btrim(f.first_name || ' ' || f.surname) into farmer_profile, farmer_name
  from public.farmers f where f.farmer_id = new.farmer_id;
  select c.name into commodity_name from public.commodities c where c.commodity_id = new.commodity_id;

  if tg_op = 'INSERT' then
    if new.filed_by is not null then
      perform public.notify_role(
        'mao_admin', 'request', 'Request awaiting your review',
        'The Farmers'' Association President filed a request for ' || coalesce(commodity_name, 'a commodity')
          || ' on behalf of ' || coalesce(farmer_name, 'a farmer') || '.',
        '/requests?status=endorsed'
      );
      perform public.notify_user(
        farmer_profile, 'request', 'A request was filed for you',
        'Your Farmers'' Association President filed a request for ' || coalesce(commodity_name, 'a commodity')
          || ' on your behalf. It is now waiting for the MAO''s approval.',
        '/requests'
      );
    else
      perform public.notify_role(
        'fa_president', 'request', 'New commodity request',
        'A farmer requested ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests'
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'forwarded' then
      perform public.notify_role(
        'mao_admin', 'request', 'Request awaiting your review',
        'The Farmers'' Association President endorsed a request for ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests'
      );
    elsif new.status = 'rejected' and old.status = 'pending' then
      perform public.notify_user(
        farmer_profile, 'request', 'Your request was not endorsed',
        'Your request for ' || coalesce(commodity_name, 'a commodity') || ' was not endorsed by your Farmers'' Association President.',
        '/requests'
      );
    elsif new.status in ('approved', 'rejected') then
      perform public.notify_user(
        farmer_profile, 'request',
        'Your request was ' || new.status,
        'Your request for ' || coalesce(commodity_name, 'a commodity') || ' was ' || new.status || '.',
        '/requests'
      );
    end if;
  end if;
  return new;
end;
$$;

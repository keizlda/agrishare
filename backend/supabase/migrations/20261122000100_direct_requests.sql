-- Client request (MAO presentation, Nov 2026): farmer requests go straight
-- to the MAO Admin. There is no endorsement step any more:
--   Pending → Approved / Rejected (by the MAO Admin; a reason is required to
--   reject).
-- The Farmers' Association President sees every request at the same time
-- and may add a remark or mark it "Recommended by Farmers' Association
-- President" while it's Pending — this never blocks the MAO Admin. A request
-- filed by the Farmers' Association President for a farmer also starts
-- Pending (tagged by filed_by).
--
-- Existing Endorsed requests become Pending, recommended, with the remarks
-- kept; decided requests stay as they are.

alter table public.requests
  add column if not exists fa_recommended boolean not null default false,
  add column if not exists fa_recommended_at timestamptz;

comment on column public.requests.fa_recommended is 'Marked "Recommended by Farmers'' Association President" (optional; never required).';

update public.requests set
  status = 'pending',
  fa_recommended = true,
  fa_recommended_at = coalesce(fa_decision_at, forwarded_to_admin_at, updated_at)
where status = 'forwarded';

-- The endorsement step is gone for good.
alter table public.requests add constraint requests_no_endorsement_step check (status <> 'forwarded');

-- ---------------------------------------------------------------------------
-- Who may change what
-- ---------------------------------------------------------------------------
drop policy if exists "requests: FA forwards or rejects pending" on public.requests;
drop policy if exists "requests: MAO approves or rejects forwarded" on public.requests;
drop policy if exists "requests: FA President files for a farmer" on public.requests;

create policy "requests: MAO decides pending" on public.requests
  for update to authenticated
  using (public.current_role() = 'mao_admin' and status = 'pending')
  with check (public.current_role() = 'mao_admin' and status in ('approved', 'rejected'));

create policy "requests: FA President recommends pending" on public.requests
  for update to authenticated
  using (public.current_role() = 'fa_president' and status = 'pending')
  with check (public.current_role() = 'fa_president' and status = 'pending');

create policy "requests: FA President files for a farmer" on public.requests
  for insert to authenticated
  with check (
    public.current_role() = 'fa_president'
    and filed_by = auth.uid()
    and status = 'pending'
    and exists (select 1 from public.farmers f where f.farmer_id = requests.farmer_id and f.deleted_at is null)
  );

-- New requests always start Pending; nothing about a decision can be set
-- by whoever inserts.
create or replace function public.request_insert_defaults()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
begin
  if r in ('farmer', 'fa_president') then
    new.status := 'pending';
    new.filed_by := case when r = 'fa_president' then auth.uid() else null end;
    new.fa_recommended := false;
    new.fa_recommended_at := null;
    new.fa_remarks := null;
    new.mao_remarks := null;
    new.reviewed_by_fa := null;
    new.reviewed_by_mao := null;
    new.fa_decision_at := null;
    new.forwarded_to_admin_at := null;
    new.admin_decision_at := null;
    new.created_at := now();
  end if;
  return new;
end;
$$;

-- Each role changes only its own part: the Farmers' Association President
-- the recommendation and remark; the MAO Admin the decision and its reason.
create or replace function public.request_decision_fields_only()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
  allowed text[];
begin
  if r = 'fa_president' then
    allowed := array['fa_remarks', 'fa_recommended', 'fa_recommended_at', 'reviewed_by_fa', 'updated_at'];
  elsif r = 'mao_admin' then
    allowed := array['status', 'mao_remarks', 'reviewed_by_mao', 'admin_decision_at', 'updated_at'];
  else
    return new;
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Only the decision and its remarks can be changed on a request.';
  end if;
  if r = 'mao_admin' and new.status = 'rejected' and nullif(btrim(coalesce(new.mao_remarks, '')), '') is null then
    raise exception 'Give a reason for rejecting this request.';
  end if;
  if r = 'fa_president' and char_length(coalesce(new.fa_remarks, '')) > 500 then
    raise exception 'Keep the remark to 500 characters or fewer.';
  end if;
  return new;
end;
$$;

-- Who and when, from the signed-in user and the server clock.
create or replace function public.request_decision_stamps()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
begin
  if r = 'fa_president' and (new.fa_recommended is distinct from old.fa_recommended or new.fa_remarks is distinct from old.fa_remarks) then
    new.reviewed_by_fa := auth.uid();
    new.fa_recommended_at := now();
    new.fa_remarks := nullif(btrim(coalesce(new.fa_remarks, '')), '');
  elsif r = 'mao_admin' and new.status is distinct from old.status then
    new.reviewed_by_mao := auth.uid();
    new.admin_decision_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications
--   New request (farmer): the MAO Admin and the Farmers' Association
--     President, at the same time.
--   Filed by the Farmers' Association President: the MAO Admin, and the
--     farmer (if they have an account).
--   Recommended: the MAO Admin.
--   Approved / Rejected: the farmer (with the MAO's remarks).
-- ---------------------------------------------------------------------------
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
  select c.name || coalesce(' · ' || t.name, '') into commodity_name
  from public.commodities c left join public.commodity_types t on t.commodity_type_id = new.commodity_type_id
  where c.commodity_id = new.commodity_id;

  if tg_op = 'INSERT' then
    if new.filed_by is not null then
      perform public.notify_role(
        'mao_admin', 'request', 'New commodity request',
        'The Farmers'' Association President filed a request for ' || coalesce(commodity_name, 'a commodity')
          || ' on behalf of ' || coalesce(farmer_name, 'a farmer') || '.',
        '/requests?status=pending'
      );
      perform public.notify_user(
        farmer_profile, 'request', 'A request was filed for you',
        'Your Farmers'' Association President filed a request for ' || coalesce(commodity_name, 'a commodity')
          || ' on your behalf. It is now with the MAO.',
        '/requests'
      );
    else
      perform public.notify_role(
        'mao_admin', 'request', 'New commodity request',
        coalesce(farmer_name, 'A farmer') || ' requested ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests?status=pending'
      );
      perform public.notify_role(
        'fa_president', 'request', 'New commodity request',
        coalesce(farmer_name, 'A farmer') || ' requested ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests?status=pending'
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if new.fa_recommended and not old.fa_recommended then
      perform public.notify_role(
        'mao_admin', 'request', 'Request recommended',
        'The Farmers'' Association President recommended ' || coalesce(farmer_name, 'a farmer') || '''s request for '
          || coalesce(commodity_name, 'a commodity') || '.',
        '/requests?status=pending'
      );
    end if;
    if old.status is distinct from new.status and new.status in ('approved', 'rejected') then
      perform public.notify_user(
        farmer_profile, 'request',
        'Your request was ' || new.status,
        'Your request for ' || coalesce(commodity_name, 'a commodity') || ' was ' || new.status || ' by the MAO.'
          || coalesce(' Remarks: ' || nullif(btrim(new.mao_remarks), ''), ''),
        '/requests'
      );
    end if;
  end if;
  return new;
end;
$$;

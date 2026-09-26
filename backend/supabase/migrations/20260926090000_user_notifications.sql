-- Per-user notifications (bell dropdown + farmer updates). The existing
-- public.notifications table is a broadcast/announcement model (no owner
-- column; read state lives in notification_reads), so it can't express "this
-- specific farmer's submission was rejected". This is a separate, user-owned
-- table; announcements are untouched.
--
-- Every "endpoint" the UI needs (list, mark read/unread, mark all read,
-- delete one, clear read) is a plain table operation through the Supabase
-- client, scoped by RLS to auth.uid() — a user can never see or touch
-- another user's rows. Clients have no INSERT policy: rows are created only
-- by the security-definer triggers below.

create table public.user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('validated', 'rejected', 'validation', 'request', 'distribution', 'system')),
  title text not null,
  message text not null default '',
  link text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_user_notifications_user_created on public.user_notifications (user_id, created_at desc);
create index idx_user_notifications_user_unread on public.user_notifications (user_id) where not is_read;

alter table public.user_notifications enable row level security;

create policy "user_notifications: read own" on public.user_notifications
  for select using (user_id = auth.uid());
create policy "user_notifications: update own" on public.user_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_notifications: delete own" on public.user_notifications
  for delete using (user_id = auth.uid());

-- Table-level grants: the blanket grant in 20260812143108_grants.sql gives
-- authenticated full access to every table, so narrow this one back down —
-- clients may only read, flip read state, and delete.
revoke all on public.user_notifications from anon, authenticated;
grant select, delete on public.user_notifications to authenticated;
grant update (is_read, read_at) on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;

-- ---------------------------------------------------------------------------
-- Creation helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_message text, p_link text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_notifications (user_id, type, title, message, link)
  select p_user_id, p_type, p_title, coalesce(p_message, ''), p_link
  where p_user_id is not null
$$;

create or replace function public.notify_role(
  p_role public.user_role, p_type text, p_title text, p_message text, p_link text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_notifications (user_id, type, title, message, link)
  select id, p_type, p_title, coalesce(p_message, ''), p_link
  from public.profiles
  where role = p_role
$$;

revoke execute on function public.notify_user(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_role(public.user_role, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Crop validation: submitted -> tell the MAO admins; reviewed -> tell the farmer
-- ---------------------------------------------------------------------------
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
      '/validation'
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
        '/validation'
      );
    else
      perform public.notify_user(
        farmer_profile, 'rejected', 'Your crop validation was rejected',
        coalesce('Reason: ' || preview, 'Open the app to see the reason and resubmit.'),
        '/validation'
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger notify_crop_validation_change
  after insert or update on public.crop_validations
  for each row execute function public.notify_crop_validation_change();

-- ---------------------------------------------------------------------------
-- Requests: created -> FA president; forwarded -> MAO admin; decided -> farmer
-- ---------------------------------------------------------------------------
create or replace function public.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  commodity_name text;
begin
  select f.profile_id into farmer_profile from public.farmers f where f.farmer_id = new.farmer_id;
  select c.name into commodity_name from public.commodities c where c.commodity_id = new.commodity_id;

  if tg_op = 'INSERT' then
    perform public.notify_role(
      'fa_president', 'request', 'New commodity request',
      'A farmer requested ' || coalesce(commodity_name, 'a commodity') || '.',
      '/requests'
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'forwarded' then
      perform public.notify_role(
        'mao_admin', 'request', 'Request awaiting your review',
        'The FA President approved a request for ' || coalesce(commodity_name, 'a commodity') || '.',
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

create trigger notify_request_change
  after insert or update on public.requests
  for each row execute function public.notify_request_change();

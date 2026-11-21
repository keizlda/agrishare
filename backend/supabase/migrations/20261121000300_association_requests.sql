-- Review suggestion (Nov 2026): the Farmers' Association President can ask
-- the MAO for machinery, a project or other support on behalf of the
-- association ("association requests"), separate from farmers' commodity
-- requests.
--
--   Farmers' Association President: creates requests, sees their own, and
--     can edit or cancel one only while it is Pending.
--   MAO Admin: sees every request and moves it to Under review, Approved or
--     Rejected (a rejection needs remarks).
--   Farmers: no access.
-- Every change is audit-logged; the MAO is notified of new requests and the
-- Farmers' Association President of every status change.

create type public.association_request_type as enum ('machinery', 'project', 'other');
create type public.association_request_status as enum ('pending', 'under_review', 'approved', 'rejected');

create table public.association_requests (
  association_request_id bigint generated always as identity primary key,
  request_type public.association_request_type not null,
  title text not null,
  description text not null,
  item text,
  quantity integer,
  estimated_beneficiaries integer,
  preferred_date date,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  status public.association_request_status not null default 'pending',
  requested_by uuid not null default auth.uid() references public.profiles (id),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  admin_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint association_requests_title_length check (char_length(btrim(title)) between 3 and 120),
  constraint association_requests_description_length check (char_length(btrim(description)) between 10 and 2000),
  constraint association_requests_item_length check (item is null or char_length(item) <= 120),
  constraint association_requests_quantity_range check (quantity is null or quantity between 1 and 10000),
  constraint association_requests_beneficiaries_range check (estimated_beneficiaries is null or estimated_beneficiaries between 1 and 100000),
  constraint association_requests_remarks_length check (admin_remarks is null or char_length(admin_remarks) <= 1000),
  constraint association_requests_attachment_type check (attachment_type is null or attachment_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
);

create index association_requests_requested_by_idx on public.association_requests (requested_by);
create index association_requests_status_idx on public.association_requests (status) where deleted_at is null;

comment on table public.association_requests is 'Machinery, project or other requests the Farmers'' Association President sends to the MAO.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.association_requests enable row level security;
revoke all on public.association_requests from anon;
grant select, insert, update on public.association_requests to authenticated;

create policy "association requests: MAO reads all, FA President reads own"
  on public.association_requests for select to authenticated
  using (
    public.current_role() = 'mao_admin'
    or (public.current_role() = 'fa_president' and requested_by = auth.uid())
  );

create policy "association requests: FA President creates"
  on public.association_requests for insert to authenticated
  with check (public.current_role() = 'fa_president' and requested_by = auth.uid() and status = 'pending');

create policy "association requests: FA President edits or cancels own pending"
  on public.association_requests for update to authenticated
  using (public.current_role() = 'fa_president' and requested_by = auth.uid() and status = 'pending' and deleted_at is null)
  with check (public.current_role() = 'fa_president' and requested_by = auth.uid() and status = 'pending');

create policy "association requests: MAO reviews"
  on public.association_requests for update to authenticated
  using (public.current_role() = 'mao_admin' and deleted_at is null)
  with check (public.current_role() = 'mao_admin');

-- No delete policy: cancelling sets deleted_at, so the record stays.

-- ---------------------------------------------------------------------------
-- Field rules and who may change what (RLS can't limit columns). Messages
-- (SQLSTATE P0001) are shown as written.
-- ---------------------------------------------------------------------------
create or replace function public.association_request_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.current_role();
  fa_fields text[] := array['request_type', 'title', 'description', 'item', 'quantity', 'estimated_beneficiaries',
    'preferred_date', 'attachment_path', 'attachment_name', 'attachment_type', 'deleted_at', 'updated_at'];
  mao_fields text[] := array['status', 'admin_remarks', 'reviewed_by', 'reviewed_at', 'updated_at'];
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if tg_op = 'INSERT' then
    -- A signed-in user (RLS lets only the Farmers' Association President
    -- insert) always starts a Pending request of their own. Only the
    -- service role (seed data) may load other values.
    if r is not null then
      new.requested_by := auth.uid();
      new.status := 'pending';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.admin_remarks := null;
      new.deleted_at := null;
      new.created_at := now();
      new.updated_at := now();
    end if;
  else
    if old.deleted_at is not null then
      raise exception 'This request was cancelled.';
    end if;
    if r = 'fa_president' then
      if (to_jsonb(new) - fa_fields) is distinct from (to_jsonb(old) - fa_fields) then
        raise exception 'Only the request''s details can be changed, and only while it is Pending.';
      end if;
    elsif r = 'mao_admin' then
      if (to_jsonb(new) - mao_fields) is distinct from (to_jsonb(old) - mao_fields) then
        raise exception 'Only the status and remarks can be changed on an association request.';
      end if;
      if old.status in ('approved', 'rejected') then
        raise exception 'This request has already been decided.';
      end if;
      if new.status = 'pending' and old.status <> 'pending' then
        raise exception 'A request can''t go back to Pending.';
      end if;
      if new.status = 'rejected' and nullif(btrim(coalesce(new.admin_remarks, '')), '') is null then
        raise exception 'Give a reason for rejecting this request.';
      end if;
      -- Who reviewed and when: the signed-in MAO Admin, now.
      if new.status is distinct from old.status then
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      else
        new.reviewed_by := old.reviewed_by;
        new.reviewed_at := old.reviewed_at;
      end if;
    end if;
  end if;

  new.title := btrim(new.title);
  new.description := btrim(new.description);
  new.item := nullif(btrim(coalesce(new.item, '')), '');
  new.admin_remarks := nullif(btrim(coalesce(new.admin_remarks, '')), '');
  if char_length(coalesce(new.title, '')) < 3 then
    raise exception 'Enter a title (at least 3 characters).';
  end if;
  if char_length(new.title) > 120 then
    raise exception 'Keep the title to 120 characters or fewer.';
  end if;
  if char_length(coalesce(new.description, '')) < 10 then
    raise exception 'Describe the request and why it''s needed (at least 10 characters).';
  end if;
  if char_length(new.description) > 2000 then
    raise exception 'Keep the description to 2,000 characters or fewer.';
  end if;
  if new.quantity is not null and (new.quantity < 1 or new.quantity > 10000) then
    raise exception 'Enter a quantity from 1 to 10,000.';
  end if;
  if new.estimated_beneficiaries is not null and (new.estimated_beneficiaries < 1 or new.estimated_beneficiaries > 100000) then
    raise exception 'Enter an estimated number of beneficiaries from 1 to 100,000.';
  end if;
  if new.preferred_date is not null and new.preferred_date < v_today
     and (tg_op = 'INSERT' or new.preferred_date is distinct from old.preferred_date) then
    raise exception 'Choose a preferred date from today onward.';
  end if;
  if new.preferred_date is not null and new.preferred_date > (v_today + interval '2 years')::date
     and (tg_op = 'INSERT' or new.preferred_date is distinct from old.preferred_date) then
    raise exception 'Choose a preferred date within the next 2 years.';
  end if;
  if new.attachment_path is not null and split_part(new.attachment_path, '/', 1) <> new.requested_by::text then
    raise exception 'That attachment doesn''t belong to this request.';
  end if;
  return new;
end;
$$;

create trigger association_request_guard before insert or update on public.association_requests
  for each row execute function public.association_request_guard();

-- ---------------------------------------------------------------------------
-- Notifications: the MAO hears about new requests; the Farmers' Association
-- President hears about every status change.
-- ---------------------------------------------------------------------------
create or replace function public.notify_association_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into v_name from public.profiles where id = new.requested_by;
    perform public.notify_role(
      'mao_admin', 'request', 'New association request',
      coalesce(nullif(v_name, ''), 'The Farmers'' Association President') || ' requested: ' || new.title || '.',
      '/requests?section=association'
    );
  elsif new.status is distinct from old.status then
    perform public.notify_user(
      new.requested_by, 'request',
      case new.status
        when 'under_review' then 'Association request under review'
        when 'approved' then 'Association request approved'
        when 'rejected' then 'Association request rejected'
        else 'Association request updated'
      end,
      'Your request "' || new.title || '" '
        || case new.status
             when 'under_review' then 'is now under review by the MAO.'
             when 'approved' then 'was approved by the MAO.'
             when 'rejected' then 'was rejected by the MAO.'
             else 'was updated.'
           end
        || coalesce(' Remarks: ' || new.admin_remarks, ''),
      '/requests?section=association'
    );
  end if;
  return new;
end;
$$;

create trigger notify_association_request_change after insert or update on public.association_requests
  for each row execute function public.notify_association_request_change();

create trigger set_updated_at before update on public.association_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log: association_request_id is the record id.
-- ---------------------------------------------------------------------------
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
begin
  old_data := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_data := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  rec_id := coalesce(
    (new_data ->> 'association_request_id'), (old_data ->> 'association_request_id'),
    (new_data ->> 'claim_id'), (old_data ->> 'claim_id'),
    (new_data ->> 'event_id'), (old_data ->> 'event_id'),
    (new_data ->> 'event_item_id'), (old_data ->> 'event_item_id'),
    (new_data ->> 'request_id'), (old_data ->> 'request_id'),
    (new_data ->> 'commodity_id'), (old_data ->> 'commodity_id'),
    (new_data ->> 'announcement_id'), (old_data ->> 'announcement_id'),
    (new_data ->> 'farmer_id'), (old_data ->> 'farmer_id')
  );
  select role into actor_role from public.profiles where id = auth.uid();

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
  values (
    auth.uid(), actor_role, TG_TABLE_NAME, lower(TG_OP), rec_id,
    initcap(TG_OP) || ' on ' || TG_TABLE_NAME || coalesce(' (id ' || rec_id || ')', ''),
    jsonb_build_object('old', old_data, 'new', new_data),
    coalesce(new_data, old_data)
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_association_requests after insert or update or delete on public.association_requests
  for each row execute function public.log_audit_event();

-- ---------------------------------------------------------------------------
-- Attachments: a private bucket (image or PDF, up to 5 MB). Path:
-- {requester's user id}/{random}.{ext}. The Farmers' Association President
-- uploads to and reads their own folder; the MAO Admin reads all.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('association-attachments', 'association-attachments', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "association attachments: FA President uploads own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'association-attachments'
    and public.current_role() = 'fa_president'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "association attachments: FA President own, MAO all"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'association-attachments'
    and (
      public.current_role() = 'mao_admin'
      or (public.current_role() = 'fa_president' and (storage.foldername(name))[1] = auth.uid()::text)
    )
  );

-- Replacing an attachment while the request is still Pending removes the old
-- file; one on a request that's past Pending stays.
create policy "association attachments: FA President removes own unused"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'association-attachments'
    and public.current_role() = 'fa_president'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.association_requests a
      where a.attachment_path = storage.objects.name and a.status <> 'pending'
    )
  );

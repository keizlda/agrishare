-- Client request (MAO presentation, Nov 2026): the item of an association
-- request comes from a list the MAO Admin manages (add, edit, remove — no
-- hardcoding), starting with common machinery and projects and an
-- "Other (specify)" entry. A request now has: type, item (from the list),
-- quantity (for machinery), purpose / justification, number of farmer
-- beneficiaries, preferred date, optional attachment. The title is no
-- longer typed: it's the item.

create table public.association_request_items (
  item_id bigint generated always as identity primary key,
  name text not null,
  is_other boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint association_request_items_name_length check (char_length(btrim(name)) between 1 and 80)
);
create unique index association_request_items_active_name_key on public.association_request_items (lower(btrim(name))) where deleted_at is null;

alter table public.association_request_items enable row level security;
revoke all on public.association_request_items from anon;
grant select, insert, update on public.association_request_items to authenticated;

-- Staff read the list (the Farmers' Association President picks from it);
-- only the MAO Admin changes it. Farmers have no association requests.
create policy "association items: staff read" on public.association_request_items
  for select to authenticated using (public.is_staff());
create policy "association items: MAO adds" on public.association_request_items
  for insert to authenticated with check (public.current_role() = 'mao_admin');
create policy "association items: MAO edits" on public.association_request_items
  for update to authenticated using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

create or replace function public.association_item_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' then
    raise exception 'Enter the item name.';
  end if;
  if char_length(new.name) > 80 then
    raise exception 'Keep the item name to 80 characters or fewer.';
  end if;
  if new.deleted_at is null and exists (
    select 1 from public.association_request_items i
    where i.deleted_at is null and lower(i.name) = lower(new.name) and i.item_id is distinct from new.item_id
  ) then
    raise exception 'The list already has %.', new.name;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger association_item_guard before insert or update on public.association_request_items
  for each row execute function public.association_item_guard();

-- Activity Log: item_id is the record id (after the request's own id).
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

create trigger audit_association_request_items after insert or update or delete on public.association_request_items
  for each row execute function public.log_audit_event();

-- Starting list (all editable).
insert into public.association_request_items (name, is_other, sort_order) values
  ('Hand tractor', false, 10),
  ('Four-wheel tractor', false, 20),
  ('Rice thresher', false, 30),
  ('Combine harvester', false, 40),
  ('Rice transplanter', false, 50),
  ('Water pump', false, 60),
  ('Irrigation rehabilitation', false, 70),
  ('Farm-to-market road', false, 80),
  ('Post-harvest facility', false, 90),
  ('Other (specify)', true, 1000);

-- ---------------------------------------------------------------------------
-- Association requests: item from the list (+ "specify" for Other)
-- ---------------------------------------------------------------------------
alter table public.association_requests
  add column if not exists item_id bigint references public.association_request_items (item_id),
  add column if not exists item_other text;
alter table public.association_requests alter column title drop not null;
alter table public.association_requests drop constraint if exists association_requests_title_length;
alter table public.association_requests add constraint association_requests_title_length check (title is null or char_length(btrim(title)) between 1 and 120);
alter table public.association_requests add constraint association_requests_item_other_length check (item_other is null or char_length(item_other) <= 80);

comment on column public.association_requests.item is 'The item''s name when the request was made (or the "Other" text), kept for history.';

-- Existing requests: match their free-text item to the list, else Other.
update public.association_requests a set
  item_id = coalesce(
    (select i.item_id from public.association_request_items i where i.deleted_at is null and not i.is_other and lower(i.name) = lower(btrim(coalesce(a.item, '')))),
    (select i.item_id from public.association_request_items i where i.deleted_at is null and lower(i.name) like lower(btrim(coalesce(a.item, ''))) || '%' and coalesce(a.item, '') <> '' and not i.is_other order by i.sort_order limit 1),
    (select i.item_id from public.association_request_items i where i.is_other and i.deleted_at is null limit 1)
  ),
  item_other = case
    when exists (select 1 from public.association_request_items i where i.deleted_at is null and not i.is_other
                 and (lower(i.name) = lower(btrim(coalesce(a.item, ''))) or (coalesce(a.item, '') <> '' and lower(i.name) like lower(btrim(a.item)) || '%')))
      then null
    else coalesce(nullif(btrim(a.item), ''), a.title)
  end
where a.item_id is null;

create or replace function public.association_request_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.current_role();
  fa_fields text[] := array['request_type', 'title', 'description', 'item', 'item_id', 'item_other', 'quantity', 'estimated_beneficiaries',
    'preferred_date', 'attachment_path', 'attachment_name', 'attachment_type', 'deleted_at', 'updated_at'];
  mao_fields text[] := array['status', 'admin_remarks', 'reviewed_by', 'reviewed_at', 'updated_at'];
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_item public.association_request_items%rowtype;
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
      if new.status is distinct from old.status then
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      else
        new.reviewed_by := old.reviewed_by;
        new.reviewed_at := old.reviewed_at;
      end if;
      return new;
    end if;
  end if;

  -- The item: from the list; "Other (specify)" needs the specific item. The
  -- item's name is kept on the request (and is its title).
  if new.item_id is null then
    raise exception 'Choose an item.';
  end if;
  select * into v_item from public.association_request_items where item_id = new.item_id;
  if not found or (v_item.deleted_at is not null and (tg_op = 'INSERT' or new.item_id is distinct from old.item_id)) then
    raise exception 'That item is no longer on the list — choose another.';
  end if;
  new.item_other := nullif(btrim(coalesce(new.item_other, '')), '');
  if v_item.is_other then
    if new.item_other is null then
      raise exception 'Specify the item.';
    end if;
    new.item := new.item_other;
  else
    new.item_other := null;
    new.item := v_item.name;
  end if;
  new.title := left(new.item, 120);

  new.description := btrim(coalesce(new.description, ''));
  new.admin_remarks := nullif(btrim(coalesce(new.admin_remarks, '')), '');
  if char_length(new.description) < 10 then
    raise exception 'Describe the purpose and why it''s needed (at least 10 characters).';
  end if;
  if char_length(new.description) > 2000 then
    raise exception 'Keep the purpose / justification to 2,000 characters or fewer.';
  end if;
  if new.request_type = 'machinery' and new.quantity is null then
    raise exception 'Enter how many units of machinery are needed.';
  end if;
  if new.quantity is not null and (new.quantity < 1 or new.quantity > 10000) then
    raise exception 'Enter a quantity from 1 to 10,000.';
  end if;
  if new.estimated_beneficiaries is null and tg_op = 'INSERT' then
    raise exception 'Enter the number of farmer beneficiaries.';
  end if;
  if new.estimated_beneficiaries is not null and (new.estimated_beneficiaries < 1 or new.estimated_beneficiaries > 100000) then
    raise exception 'Enter the number of farmer beneficiaries from 1 to 100,000.';
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

-- Notifications name the item (the title is the item now).
create or replace function public.notify_association_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_what text := coalesce(new.item, new.title, 'an association request');
begin
  if tg_op = 'INSERT' then
    select full_name into v_name from public.profiles where id = new.requested_by;
    perform public.notify_role(
      'mao_admin', 'request', 'New association request',
      coalesce(nullif(v_name, ''), 'The Farmers'' Association President') || ' requested: ' || v_what || '.',
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
      'Your request "' || v_what || '" '
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

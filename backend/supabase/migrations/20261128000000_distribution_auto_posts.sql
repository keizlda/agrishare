-- A distribution's tagged farmers see it in their announcements (Nov 28,
-- 2026).
--
-- When a distribution is saved with tagged farmers, a distribution schedule
-- post is made for exactly those farmers (and the barangay's Farmers'
-- Association President), in the distribution's barangay. It follows the
-- distribution: farmers added or removed, a new date or venue, the
-- barangay; a deleted distribution (or one with nobody tagged) takes it
-- down. The farmers already get "You're listed in an upcoming distribution",
-- so this post sends no second notification. Ongoing distributions get
-- theirs now.

alter table public.announcements add column auto_for_distribution boolean not null default false;
create unique index announcements_one_auto_post_per_distribution
  on public.announcements (linked_distribution_id)
  where auto_for_distribution and deleted_at is null;

-- A post whose distribution was deleted can still be taken down.
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
  -- (Not when the post is being taken down: its distribution may be gone.)
  if new.linked_distribution_id is not null and new.deleted_at is null then
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

-- Makes, updates or takes down a distribution's automatic post. (Internal.)
create or replace function public.sync_distribution_post(p_event bigint)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_event record;
  v_item text;
  v_ids bigint[];
  v_post bigint;
begin
  select event_id, program_name, event_date, venue, barangay_id, is_deleted, created_by
    into v_event from public.distribution_events where event_id = p_event;
  select announcement_id into v_post from public.announcements
  where linked_distribution_id = p_event and auto_for_distribution and deleted_at is null;
  select coalesce(array_agg(distinct farmer_id order by farmer_id), '{}') into v_ids
  from public.distribution_claims where event_id = p_event;

  if v_event.event_id is null or v_event.is_deleted or v_event.barangay_id is null or cardinality(v_ids) = 0 then
    if v_post is not null then
      update public.announcements set deleted_at = now() where announcement_id = v_post;
    end if;
    return;
  end if;

  if v_post is not null then
    update public.announcements set
      distribution_date = v_event.event_date,
      venue = v_event.venue,
      barangay_ids = array[v_event.barangay_id],
      target_farmer_ids = v_ids
    where announcement_id = v_post
      and (distribution_date is distinct from v_event.event_date or venue is distinct from v_event.venue
           or barangay_ids is distinct from array[v_event.barangay_id] or target_farmer_ids is distinct from v_ids);
    return;
  end if;

  select c.name into v_item
  from public.distribution_event_items i join public.commodities c on c.commodity_id = i.commodity_id
  where i.event_id = p_event order by i.event_item_id limit 1;
  insert into public.announcements (
    title, body, audience, all_barangays, barangay_ids, status, distribution_date, venue,
    linked_distribution_id, target_farmer_ids, auto_for_distribution, created_by
  ) values (
    left(v_event.program_name || coalesce(' — ' || v_item, ''), 150),
    'You are listed to receive ' || coalesce(v_item, 'this distribution') || ' in ' || v_event.program_name
      || '. Please come on the date and to the venue shown.',
    'everyone', false, array[v_event.barangay_id], 'published', v_event.event_date, v_event.venue,
    p_event, v_ids, true, v_event.created_by
  );
end;
$function$;
revoke execute on function public.sync_distribution_post(bigint) from anon, public, authenticated;

-- Farmers tagged or untagged (once per statement, per distribution).
create or replace function public.distribution_claims_sync_posts()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_event bigint;
begin
  if tg_op = 'INSERT' then
    for v_event in select distinct event_id from new_claims loop
      perform public.sync_distribution_post(v_event);
    end loop;
  else
    for v_event in select distinct event_id from old_claims loop
      perform public.sync_distribution_post(v_event);
    end loop;
  end if;
  return null;
end;
$function$;
create trigger distribution_claims_posts_insert
  after insert on public.distribution_claims
  referencing new table as new_claims
  for each statement execute function public.distribution_claims_sync_posts();
create trigger distribution_claims_posts_delete
  after delete on public.distribution_claims
  referencing old table as old_claims
  for each statement execute function public.distribution_claims_sync_posts();

-- The distribution itself changed (date, venue, barangay, deleted).
create or replace function public.distribution_event_sync_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sync_distribution_post(new.event_id);
  return null;
end;
$function$;
create trigger distribution_event_post
  after update of event_date, venue, barangay_id, is_deleted on public.distribution_events
  for each row execute function public.distribution_event_sync_post();

-- No second notification: the tagged farmers were already told "You're
-- listed in an upcoming distribution".
create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.auto_for_distribution then
    return new;
  end if;
  if new.status = 'published' and new.deleted_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.notify_post_audience(new.title, new.all_barangays, new.barangay_ids,
      new.audience in ('farmers', 'everyone'), new.audience in ('fa_president', 'everyone'), new.target_farmer_ids);
  end if;
  return new;
end;
$function$;

-- Ongoing distributions get their post now.
do $$
declare
  v_event bigint;
begin
  for v_event in
    select e.event_id from public.distribution_events e
    where e.status = 'ongoing' and not e.is_deleted and e.barangay_id is not null
      and exists (select 1 from public.distribution_claims c where c.event_id = e.event_id)
    order by e.event_date, e.event_id
  loop
    perform public.sync_distribution_post(v_event);
  end loop;
end;
$$;

-- Part 1: acknowledgement is now set once per distribution (the existing
-- distribution_events.acknowledgement_status dropdown) instead of per
-- farmer. distribution_claims.acknowledgement_status stays in the schema,
-- unused, per instruction — nothing writes to it going forward, but old
-- values aren't touched.

-- Case-insensitive duplicate-distribution check — Program Name is now a
-- freeform text field (no more fixed dropdown), so "RCEF Seed Distribution"
-- and "rcef seed distribution" must be treated as the same program.
create or replace function public.find_duplicate_distribution(
  p_farmer_id bigint, p_commodity_id bigint, p_program_name text, p_year int, p_exclude_event_id bigint default null
)
returns table (event_id bigint, program_name text, event_date date, quantity_received numeric)
language sql stable
security definer
set search_path = public
as $$
  select e.event_id, e.program_name, e.event_date, c.quantity_received
  from public.distribution_claims c
  join public.distribution_events e on e.event_id = c.event_id
  where c.farmer_id = p_farmer_id
    and c.commodity_id = p_commodity_id
    and lower(e.program_name) = lower(p_program_name)
    and extract(year from e.event_date) = p_year
    and e.is_deleted = false
    and (p_exclude_event_id is null or e.event_id <> p_exclude_event_id)
  order by e.event_date desc
  limit 1
$$;

-- Per-farmer "received" notification now fires off the single
-- distribution-level acknowledgement instead of a per-claim toggle.
-- notified_at is already spoken for (guards the separate "you're tagged in
-- an upcoming distribution" notification below), so a second column tracks
-- "already sent the received notification" for this one.
alter table public.distribution_claims add column received_notified_at timestamptz;

drop trigger if exists notify_beneficiary_received on public.distribution_claims;
drop function if exists public.notify_beneficiary_received();

drop trigger if exists notify_distribution_completed on public.distribution_events;
drop function if exists public.notify_distribution_completed();

create or replace function public.notify_distribution_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.status = 'completed' and old.status is distinct from 'completed')
     or (new.acknowledgement_status = 'acknowledged' and old.acknowledgement_status is distinct from 'acknowledged') then
    insert into public.user_notifications (user_id, type, title, message, link)
    select f.profile_id, 'distribution', 'You received a distribution',
           'You received ' || coalesce(new.program_name, 'a distribution') || '. Open My Distributions for details.',
           '/my-distributions'
    from public.distribution_claims c
    join public.farmers f on f.farmer_id = c.farmer_id
    where c.event_id = new.event_id and c.received_notified_at is null and f.profile_id is not null;

    update public.distribution_claims
    set received_notified_at = now()
    where event_id = new.event_id and received_notified_at is null;
  end if;
  return new;
end;
$$;

create trigger notify_distribution_received
  after update on public.distribution_events
  for each row execute function public.notify_distribution_received();

-- A farmer tagged after the distribution is already Completed/Acknowledged
-- should still get the "you received" notification right away, not just
-- the "you're tagged in an upcoming distribution" one (which only makes
-- sense while it's still scheduled/ongoing).
create or replace function public.notify_distribution_claim_tagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  event_status public.distribution_status;
  event_ack public.acknowledgement_status;
  event_program text;
begin
  if new.notified_at is not null then
    return new;
  end if;

  select status, acknowledgement_status, program_name into event_status, event_ack, event_program
    from public.distribution_events where event_id = new.event_id;

  select profile_id into farmer_profile from public.farmers where farmer_id = new.farmer_id;

  if event_status = 'completed' or event_ack = 'acknowledged' then
    perform public.notify_user(
      farmer_profile, 'distribution', 'You received a distribution',
      'You received ' || coalesce(event_program, 'a distribution') || '. Open My Distributions for details.',
      '/my-distributions'
    );
    update public.distribution_claims set received_notified_at = now() where claim_id = new.claim_id;
  elsif event_status in ('scheduled', 'ongoing') then
    perform public.notify_user(
      farmer_profile, 'distribution', 'You''re listed in an upcoming distribution',
      'You were tagged in ' || coalesce(event_program, 'a distribution') || '. Check My Distributions for details.',
      '/my-distributions'
    );
  end if;

  update public.distribution_claims set notified_at = now() where claim_id = new.claim_id;
  return new;
end;
$$;

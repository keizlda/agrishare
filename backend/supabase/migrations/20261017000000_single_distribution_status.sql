-- Distribution "Status" and "Acknowledgement Status" become ONE three-step
-- status. Acknowledgement (paper Section 3.2.1) is still recorded: it is the
-- last step, and its date is kept in receipts_collected_at.
--   ongoing     – scheduled or in progress
--   distributed – items released to farmers; signed acknowledgement
--                 receipts not yet filed
--   completed   – signed acknowledgement receipts collected and filed
--
-- Existing rows:
--   scheduled / ongoing (any acknowledgement) -> ongoing
--   completed + pending acknowledgement       -> distributed
--   completed + acknowledged                  -> completed
--   cancelled                                 -> ongoing (only ever used on
--                                                distributions that are
--                                                already deleted)
-- Every row's old values are written to audit_logs before converting.
--
-- The old acknowledgement column is kept (renamed to
-- legacy_acknowledgement_status, values untouched) but no longer used by the
-- apps. acknowledgement_status is now a generated column derived from status
-- (completed = acknowledged, otherwise pending), so reports and queries that
-- read it keep working.
--
-- RLS needs no change: "events: everyone reads" / "events: MAO writes" don't
-- look at status.

-- ============================================================================
-- 1. Audit log: record every distribution's old status + acknowledgement and
-- what it becomes, before the old values are converted away.
-- ============================================================================
insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
select
  null, null, 'distribution_events', 'update', e.event_id::text,
  'Status merged into one status: ' || e.status || ' + ' || e.acknowledgement_status || ' acknowledgement -> ' || m.new_status,
  jsonb_build_object(
    'old', jsonb_build_object('status', e.status, 'acknowledgement_status', e.acknowledgement_status),
    'new', jsonb_build_object('status', m.new_status)
  ),
  jsonb_build_object('event_id', e.event_id, 'status', m.new_status)
from public.distribution_events e
cross join lateral (
  select case
    when e.status::text = 'completed' and e.acknowledgement_status = 'acknowledged' then 'completed'
    when e.status::text = 'completed' then 'distributed'
    else 'ongoing'
  end as new_status
) m;

-- ============================================================================
-- 2. New status type: ongoing / distributed / completed.
-- (Postgres can't drop enum values, so the type is replaced.)
-- ============================================================================
alter type public.distribution_status rename to distribution_status_old;
create type public.distribution_status as enum ('ongoing', 'distributed', 'completed');

alter table public.distribution_events alter column status drop default;
alter table public.distribution_events
  alter column status type public.distribution_status
  using (case
    when status::text = 'completed' and acknowledgement_status = 'acknowledged' then 'completed'
    when status::text = 'completed' then 'distributed'
    else 'ongoing'
  end)::public.distribution_status;
alter table public.distribution_events alter column status set default 'ongoing';

drop type public.distribution_status_old;

comment on column public.distribution_events.status is
  'ongoing = scheduled or in progress; distributed = items released, signed acknowledgement receipts not yet filed; completed = signed acknowledgement receipts collected and filed.';

-- ============================================================================
-- 3. Acknowledgement is derived from status.
-- ============================================================================
alter table public.distribution_events rename column acknowledgement_status to legacy_acknowledgement_status;
comment on column public.distribution_events.legacy_acknowledgement_status is
  'DEPRECATED (Oct 2026): the separate acknowledgement dropdown, kept for reference only and no longer written. Use acknowledgement_status (derived from status).';

alter table public.distribution_events
  add column acknowledgement_status public.acknowledgement_status
  generated always as (
    case when status = 'completed' then 'acknowledged'::public.acknowledgement_status else 'pending'::public.acknowledgement_status end
  ) stored;
comment on column public.distribution_events.acknowledgement_status is
  'Derived from status: acknowledged when completed (signed receipts collected), otherwise pending.';

-- ============================================================================
-- 4. When the signed acknowledgement receipts were collected.
-- ============================================================================
alter table public.distribution_events add column receipts_collected_at timestamptz;
comment on column public.distribution_events.receipts_collected_at is
  'Set automatically when status becomes completed; cleared if it moves back.';

-- Backfill already-completed rows with the best date available (when their
-- status was last changed, else the distribution date). Triggers are off for
-- this one statement so it doesn't add audit rows or notifications on top of
-- the conversion entries written in step 1.
alter table public.distribution_events disable trigger user;
update public.distribution_events
  set receipts_collected_at = coalesce(status_updated_at, event_date::timestamptz)
  where status = 'completed';
alter table public.distribution_events enable trigger user;

create or replace function public.set_distribution_receipts_collected_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.receipts_collected_at := coalesce(new.receipts_collected_at, now());
    end if;
  else
    new.receipts_collected_at := null;
  end if;
  return new;
end;
$$;

create trigger set_receipts_collected_at
  before insert or update on public.distribution_events
  for each row execute function public.set_distribution_receipts_collected_at();

-- ============================================================================
-- 5. Farmer notifications.
-- "You received …" goes out once per farmer (received_notified_at) when the
-- distribution becomes Distributed, or goes straight to Completed. Tagging
-- while Ongoing still sends "You're listed in an upcoming distribution".
-- ============================================================================
create or replace function public.notify_distribution_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('distributed', 'completed') and old.status is distinct from new.status then
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

create or replace function public.notify_distribution_claim_tagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  event_status public.distribution_status;
  event_program text;
begin
  if new.notified_at is not null then
    return new;
  end if;

  select status, program_name into event_status, event_program
    from public.distribution_events where event_id = new.event_id;

  select profile_id into farmer_profile from public.farmers where farmer_id = new.farmer_id;

  if event_status in ('distributed', 'completed') then
    perform public.notify_user(
      farmer_profile, 'distribution', 'You received a distribution',
      'You received ' || coalesce(event_program, 'a distribution') || '. Open My Distributions for details.',
      '/my-distributions'
    );
    update public.distribution_claims set received_notified_at = now() where claim_id = new.claim_id;
  elsif event_status = 'ongoing' then
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

notify pgrst, 'reload schema';

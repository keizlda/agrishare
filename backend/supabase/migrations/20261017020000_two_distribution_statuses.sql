-- Distribution status follows the paper (Sections 1.5.1 and 3.2.1): TWO
-- values. Replaces the three-step ongoing / distributed / completed status
-- from 20261017000000_single_distribution_status.sql.
--   ongoing   – scheduled or in progress
--   completed – items released and the beneficiaries signed the
--               acknowledgement receipt
--
-- Acknowledgement (Section 3.2.1) is not set separately. It is derived from
-- status, per distribution and per beneficiary:
--   ongoing   -> pending
--   completed -> acknowledged, dated completed_at (when it was marked
--                Completed)
--
-- Existing rows: distributed -> completed, completed -> completed,
-- ongoing -> ongoing. Each converted row gets an audit_logs entry.
--
-- Nothing is dropped except code and derived values that are rebuilt here:
--   - receipts_collected_at is renamed to completed_at (values kept);
--   - the generated acknowledgement_status column is re-created with the
--     same name and meaning (it has to come off while status changes type);
--   - legacy_acknowledgement_status and the old per-farmer columns on
--     distribution_claims are kept untouched.
--
-- RLS: no policy looks at status values, so none change. The new
-- per-beneficiary view runs with the caller's permissions, so farmers only
-- see their own rows through it (same as distribution_claims).

-- ============================================================================
-- 1. Audit log: one entry per distribution whose status changes.
-- ============================================================================
insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
select
  null, null, 'distribution_events', 'update', e.event_id::text,
  'Status simplified to two values: distributed -> completed',
  jsonb_build_object(
    'old', jsonb_build_object('status', 'distributed', 'receipts_collected_at', e.receipts_collected_at),
    'new', jsonb_build_object(
      'status', 'completed',
      'completed_at', coalesce(e.status_updated_at, e.event_date::timestamp at time zone 'Asia/Manila')
    )
  ),
  jsonb_build_object('event_id', e.event_id, 'status', 'completed')
from public.distribution_events e
where e.status::text = 'distributed';

-- ============================================================================
-- 2. The derived acknowledgement column depends on status, so it comes off
-- while status changes type and is re-created in step 5.
-- ============================================================================
alter table public.distribution_events drop column acknowledgement_status;

-- ============================================================================
-- 3. New status type: ongoing / completed.
-- (Postgres can't drop enum values, so the type is replaced.)
-- ============================================================================
alter type public.distribution_status rename to distribution_status_old;
create type public.distribution_status as enum ('ongoing', 'completed');

alter table public.distribution_events alter column status drop default;
alter table public.distribution_events
  alter column status type public.distribution_status
  using (case when status::text in ('distributed', 'completed') then 'completed' else 'ongoing' end)::public.distribution_status;
alter table public.distribution_events alter column status set default 'ongoing';

drop type public.distribution_status_old;

comment on column public.distribution_events.status is
  'ongoing = scheduled or in progress; completed = items released and beneficiaries signed the acknowledgement receipt.';

-- ============================================================================
-- 4. completed_at (was receipts_collected_at): when the distribution was
-- marked Completed. It is the acknowledgement date for every beneficiary.
-- ============================================================================
alter table public.distribution_events rename column receipts_collected_at to completed_at;
comment on column public.distribution_events.completed_at is
  'When the distribution was marked Completed (the beneficiaries'' acknowledgement date). Set automatically; cleared if it goes back to ongoing.';

-- Converted rows (formerly distributed) have no date yet: use when their
-- status was last changed (when the items were released), else the
-- distribution date. Triggers are off for this one statement so it adds no
-- audit rows or notifications on top of step 1's entries.
alter table public.distribution_events disable trigger user;
update public.distribution_events
  set completed_at = coalesce(status_updated_at, event_date::timestamp at time zone 'Asia/Manila')
  where status = 'completed' and completed_at is null;
alter table public.distribution_events enable trigger user;

drop trigger if exists set_receipts_collected_at on public.distribution_events;
drop function if exists public.set_distribution_receipts_collected_at();

create or replace function public.set_distribution_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger set_completed_at
  before insert or update on public.distribution_events
  for each row execute function public.set_distribution_completed_at();

-- ============================================================================
-- 5. Acknowledgement, derived from status.
-- ============================================================================
-- Per distribution (same column name and values as before).
alter table public.distribution_events
  add column acknowledgement_status public.acknowledgement_status
  generated always as (
    case when status = 'completed' then 'acknowledged'::public.acknowledgement_status else 'pending'::public.acknowledgement_status end
  ) stored;
comment on column public.distribution_events.acknowledgement_status is
  'Derived from status: acknowledged when completed, otherwise pending. The date is completed_at.';

-- Per beneficiary: every tagged farmer shares the distribution's
-- acknowledgement and date.
create view public.distribution_beneficiary_acknowledgement
with (security_invoker = true) as
select
  c.claim_id,
  c.event_id,
  c.commodity_id,
  c.farmer_id,
  c.quantity_received,
  e.acknowledgement_status,
  case when e.status = 'completed' then e.completed_at end as acknowledged_at
from public.distribution_claims c
join public.distribution_events e on e.event_id = c.event_id;

comment on view public.distribution_beneficiary_acknowledgement is
  'Each tagged farmer''s acknowledgement (paper Section 3.2.1): acknowledged on completed_at once the distribution is Completed, otherwise pending.';
revoke all on public.distribution_beneficiary_acknowledgement from anon;
grant select on public.distribution_beneficiary_acknowledgement to authenticated;

-- The per-distribution counts follow the same rule instead of the unused
-- per-farmer column (same columns, so callers are unaffected).
create or replace view public.distribution_beneficiary_summary as
select
  e.event_id,
  count(c.claim_id) as tagged_count,
  case when e.status = 'completed' then count(c.claim_id) else 0 end as received_count,
  coalesce(sum(c.quantity_received), 0) as total_quantity_received,
  case
    when count(c.claim_id) = 0 then 'not_tagged'
    when e.status = 'completed' then 'complete'
    else 'pending'
  end as beneficiary_status
from public.distribution_events e
left join public.distribution_claims c on c.event_id = e.event_id
group by e.event_id;

comment on column public.distribution_claims.acknowledgement_status is
  'LEGACY (Sept 2026 per-farmer toggle), kept for reference and no longer used. Each farmer''s acknowledgement is derived from the distribution''s status: see distribution_beneficiary_acknowledgement.';
comment on column public.distribution_claims.acknowledged_at is
  'LEGACY, kept for reference and no longer used. See distribution_beneficiary_acknowledgement.acknowledged_at.';

-- ============================================================================
-- 6. Farmer notifications.
-- Tagged while ongoing: "You're included in the upcoming …".
-- Marked completed: "You received …", once per farmer (received_notified_at).
-- ============================================================================
-- "20 kg of Rice Seeds" for one claim.
create or replace function public.distribution_claim_item_text(p_quantity numeric, p_commodity_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select trim_scale(p_quantity)::text || ' ' || coalesce(m.unit, 'kg') || ' of ' || coalesce(m.name, 'items')
  from (select 1) one
  left join public.commodities m on m.commodity_id = p_commodity_id
$$;

revoke execute on function public.distribution_claim_item_text(numeric, bigint) from public, anon, authenticated;

create or replace function public.notify_distribution_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.user_notifications (user_id, type, title, message, link)
    select f.profile_id, 'distribution', 'You received a distribution',
           'You received '
             || string_agg(public.distribution_claim_item_text(c.quantity_received, c.commodity_id), ', ' order by c.claim_id)
             || ' from ' || coalesce(new.program_name, 'a distribution') || '.',
           '/my-distributions'
    from public.distribution_claims c
    join public.farmers f on f.farmer_id = c.farmer_id
    where c.event_id = new.event_id and c.received_notified_at is null and f.profile_id is not null
    group by f.profile_id;

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
  ev record;
begin
  if new.notified_at is not null then
    return new;
  end if;

  select status, program_name, event_date, venue into ev
    from public.distribution_events where event_id = new.event_id;

  select profile_id into farmer_profile from public.farmers where farmer_id = new.farmer_id;

  if ev.status = 'completed' then
    perform public.notify_user(
      farmer_profile, 'distribution', 'You received a distribution',
      'You received ' || public.distribution_claim_item_text(new.quantity_received, new.commodity_id)
        || ' from ' || coalesce(ev.program_name, 'a distribution') || '.',
      '/my-distributions'
    );
    update public.distribution_claims set received_notified_at = now() where claim_id = new.claim_id;
  elsif ev.status = 'ongoing' then
    perform public.notify_user(
      farmer_profile, 'distribution', 'You''re listed in an upcoming distribution',
      'You''re included in the upcoming ' || coalesce(nullif(trim(ev.program_name), ''), 'distribution')
        || coalesce(' on ' || to_char(ev.event_date, 'FMMonth FMDD, YYYY'), '')
        || coalesce(' at ' || nullif(trim(ev.venue), ''), '') || '.',
      '/my-distributions'
    );
  end if;

  update public.distribution_claims set notified_at = now() where claim_id = new.claim_id;
  return new;
end;
$$;

notify pgrst, 'reload schema';

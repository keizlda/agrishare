-- Phase 1 of the beneficiary-tagging / duplicate-prevention / audit-log /
-- announcement-linking feature set (capstone paper Section 3.2, Scope 1.5.1,
-- DFD Process 4).
--
-- distribution_claims already exists (initial schema) and is almost exactly
-- the "distribution_beneficiaries" table asked for — it's simply unused by
-- any frontend code today (grep confirms zero references outside
-- migrations). Extending it in place rather than adding a parallel table:
-- same FK to distribution_events, same farmer_id, same quantity_received,
-- already has the right RLS (staff read all, farmer reads own; MAO-only
-- write), already has an audit trigger attached. A real rename would touch
-- three RLS policies, two FK constraints (commodity soft-delete restrict,
-- crop_validations.distribution_claim_id) and the audit trigger name for no
-- functional gain.

-- ============================================================================
-- 1. distribution_claims: beneficiary acknowledgement fields
-- ============================================================================
create type public.beneficiary_acknowledgement_status as enum ('pending', 'received');

alter table public.distribution_claims
  add column acknowledgement_status public.beneficiary_acknowledgement_status not null default 'pending',
  add column acknowledged_at timestamptz,
  add column duplicate_override_reason text,
  add column notified_at timestamptz;

-- Backfill from the old boolean so any pre-existing rows aren't silently
-- reset to pending. (acknowledged stays — nothing reads it today, dropping
-- it isn't necessary and keeps this change purely additive.)
update public.distribution_claims
set acknowledgement_status = case when acknowledged then 'received'::public.beneficiary_acknowledgement_status else 'pending'::public.beneficiary_acknowledgement_status end,
    acknowledged_at = case when acknowledged then claimed_at else null end;

-- ============================================================================
-- 2. Computed beneficiary status per distribution — deliberately NOT named
-- "acknowledgement_status" on distribution_events, because that column
-- already exists and means something else: whether the funding partner/
-- donor acknowledged the release (20260902100000_distribution_program_fields
-- .sql), a value the admin sets directly in the New/Edit Distribution form.
-- This view computes the farmer-receipt side (Pending/Partial/Complete/Not
-- Tagged) instead, surfaced in the UI as "Beneficiary Acknowledgement" so
-- the two are never confused.
-- ============================================================================
create or replace view public.distribution_beneficiary_summary as
select
  e.event_id,
  count(c.claim_id) as tagged_count,
  count(c.claim_id) filter (where c.acknowledgement_status = 'received') as received_count,
  coalesce(sum(c.quantity_received), 0) as total_quantity_received,
  case
    when count(c.claim_id) = 0 then 'not_tagged'
    when count(c.claim_id) filter (where c.acknowledgement_status = 'received') = 0 then 'pending'
    when count(c.claim_id) filter (where c.acknowledgement_status = 'received') = count(c.claim_id) then 'complete'
    else 'partial'
  end as beneficiary_status
from public.distribution_events e
left join public.distribution_claims c on c.event_id = e.event_id
group by e.event_id;

grant select on public.distribution_beneficiary_summary to authenticated;

-- ============================================================================
-- 3. Duplicate-distribution check: has this farmer already received this
-- commodity under this program name in a previous (non-deleted) distribution
-- this year? Called from the web tagging UI per-chip, before save.
-- ============================================================================
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
    and e.program_name = p_program_name
    and extract(year from e.event_date) = p_year
    and e.is_deleted = false
    and (p_exclude_event_id is null or e.event_id <> p_exclude_event_id)
  order by e.event_date desc
  limit 1
$$;

revoke execute on function public.find_duplicate_distribution(bigint, bigint, text, int, bigint) from public, anon;
grant execute on function public.find_duplicate_distribution(bigint, bigint, text, int, bigint) to authenticated;

-- ============================================================================
-- 4. Atomic save: distribution + its beneficiary rows in one transaction, so
-- a failure partway through can't leave the event saved with half its
-- beneficiaries (or vice versa) — the exact class of bug a sequential
-- insert-then-insert from the client already caused once this session.
-- p_beneficiaries is a jsonb array: [{farmer_id, quantity_received,
-- acknowledgement_status, duplicate_override_reason}, ...]. Replaces the
-- full beneficiary set for the event on every call (tag list is small,
-- diffing isn't worth the complexity).
-- ============================================================================
create or replace function public.save_distribution_beneficiaries(
  p_event_id bigint, p_commodity_id bigint, p_beneficiaries jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b jsonb;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only MAO Admin can tag distribution beneficiaries.';
  end if;

  delete from public.distribution_claims where event_id = p_event_id and commodity_id = p_commodity_id;

  for b in select * from jsonb_array_elements(p_beneficiaries)
  loop
    insert into public.distribution_claims (
      event_id, commodity_id, farmer_id, quantity_received,
      acknowledgement_status, acknowledged_at, duplicate_override_reason, released_by
    ) values (
      p_event_id,
      p_commodity_id,
      (b ->> 'farmer_id')::bigint,
      (b ->> 'quantity_received')::numeric,
      coalesce((b ->> 'acknowledgement_status')::public.beneficiary_acknowledgement_status, 'pending'),
      case when (b ->> 'acknowledgement_status') = 'received' then now() else null end,
      nullif(b ->> 'duplicate_override_reason', ''),
      auth.uid()
    );
  end loop;
end;
$$;

revoke execute on function public.save_distribution_beneficiaries(bigint, bigint, jsonb) from public, anon;
grant execute on function public.save_distribution_beneficiaries(bigint, bigint, jsonb) to authenticated;

-- "Mark all as received" bulk action from the Distribution Details panel.
create or replace function public.mark_all_beneficiaries_received(p_event_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.distribution_claims
  set acknowledgement_status = 'received', acknowledged_at = now()
  where event_id = p_event_id and acknowledgement_status <> 'received'
    and public.current_role() = 'mao_admin'
$$;

revoke execute on function public.mark_all_beneficiaries_received(bigint) from public, anon;
grant execute on function public.mark_all_beneficiaries_received(bigint) to authenticated;

-- ============================================================================
-- 5. announcements: distribution-linked fields + broadened recipients
-- ============================================================================
-- Category and expires_at were already dropped entirely in
-- 20260929090000_announcements_recipients.sql — nothing to do for those.

alter table public.announcements
  add column distribution_date date,
  add column distribution_time time,
  add column venue text,
  add column assistance_type text,
  add column requirements text,
  add column linked_distribution_id bigint references public.distribution_events (event_id) on delete set null,
  add column forwarded_by uuid references public.profiles (id),
  add column forwarded_at timestamptz;

-- for_validated_farmers only ever showed posts to *validated* farmers.
-- "All Registered Farmers" is broader (every farmer account, validated or
-- not) — a real behavior change, not just a rename, so the RLS policy is
-- rebuilt below without the validation-status gate.
drop policy "announcements: audience reads published" on public.announcements;

alter table public.announcements
  rename column for_validated_farmers to for_all_registered_farmers;

create policy "announcements: audience reads published" on public.announcements
  for select using (
    status = 'published'
    and (
      (for_all_registered_farmers and public.current_role() in ('farmer', 'fa_president'))
      or (for_fa_president and public.current_role() = 'fa_president')
    )
  );

-- FA President forwarding: a security-definer RPC rather than a direct RLS
-- update policy, because "FA President may flip for_all_registered_farmers
-- and set forwarded_by/at, but touch nothing else" isn't expressible as a
-- row policy (Postgres column-level GRANTs are per database role, and
-- fa_president/mao_admin are both just "authenticated" at that level — only
-- RLS row policies apply, which can't be scoped per-column). Bundles the
-- audit log entry and farmer notification in the same transaction.
create or replace function public.forward_announcement_to_farmers(p_announcement_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  if public.current_role() <> 'fa_president' then
    raise exception 'Only the FA President can forward announcements.';
  end if;

  select * into a from public.announcements
  where announcement_id = p_announcement_id and for_fa_president = true and status = 'published';
  if not found then
    raise exception 'Announcement not found or not available to forward.';
  end if;

  update public.announcements
  set for_all_registered_farmers = true, forwarded_by = auth.uid(), forwarded_at = now()
  where announcement_id = p_announcement_id;

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes)
  values (
    auth.uid(), 'fa_president', 'announcements', 'forward', p_announcement_id::text,
    'Forwarded announcement "' || a.title || '" to all registered farmers',
    jsonb_build_object('old', to_jsonb(a), 'new', jsonb_build_object('for_all_registered_farmers', true))
  );

  perform public.notify_role(
    'farmer', 'announcement', a.title,
    'Forwarded by your FA President.',
    '/announcements'
  );
end;
$$;

revoke execute on function public.forward_announcement_to_farmers(bigint) from public, anon;
grant execute on function public.forward_announcement_to_farmers(bigint) to authenticated;

-- ============================================================================
-- 6. audit_logs: user_role, summary, and a real {old, new} diff instead of a
-- single snapshot; attach the existing trigger to more tables.
-- ============================================================================
alter table public.audit_logs
  add column user_role public.user_role,
  add column summary text,
  add column changes jsonb;

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
    (new_data ->> 'farmer_id'), (old_data ->> 'farmer_id'),
    (new_data ->> 'request_id'), (old_data ->> 'request_id'),
    (new_data ->> 'claim_id'), (old_data ->> 'claim_id'),
    (new_data ->> 'event_id'), (old_data ->> 'event_id'),
    (new_data ->> 'event_item_id'), (old_data ->> 'event_item_id'),
    (new_data ->> 'commodity_id'), (old_data ->> 'commodity_id'),
    (new_data ->> 'announcement_id'), (old_data ->> 'announcement_id')
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

create trigger audit_distribution_events after insert or update or delete on public.distribution_events
  for each row execute function public.log_audit_event();
create trigger audit_distribution_event_items after insert or update or delete on public.distribution_event_items
  for each row execute function public.log_audit_event();
create trigger audit_commodities after insert or update or delete on public.commodities
  for each row execute function public.log_audit_event();
create trigger audit_announcements after insert or update or delete on public.announcements
  for each row execute function public.log_audit_event();

-- distribution_claims already has an audit trigger from the initial schema
-- (created before acknowledgement_status/duplicate_override_reason existed)
-- — no new trigger needed, it picks up the new columns automatically since
-- the function just does to_jsonb(new)/to_jsonb(old).

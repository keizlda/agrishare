-- Two-level request approval workflow (Farmer -> FA President -> MAO Admin
-- -> back to FA President). The core state machine already existed —
-- requests.status (pending/forwarded/approved/rejected) plus the existing
-- RLS policies already gate "FA acts on pending" and "MAO acts on
-- forwarded" — this migration adds what was missing:
--   1. Per-stage timestamps (previously only one shared updated_at existed,
--      so the UI had no way to show "FA decided on X" separately from
--      "Admin decided on Y").
--   2. A farmer-blind view for the Admin review step: Admin reviews the FA
--      President's judgment on its own merits, not the farmer's identity.
--      This is a workflow/UX boundary, not a security wall — MAO Admin
--      already has full farmer visibility everywhere else in the app via
--      the existing "farmers: staff reads all" policy — so it's enforced
--      by the view's own column list (no farmer join at all) rather than
--      by restricting MAO's existing RLS grants, which other pages rely on.

alter table public.requests
  add column forwarded_to_admin_at timestamptz,
  add column fa_decision_at timestamptz,
  add column admin_decision_at timestamptz;

comment on column public.requests.forwarded_to_admin_at is 'Set when FA President approves and the request moves to the Admin queue.';
comment on column public.requests.fa_decision_at is 'When the FA President approved or rejected this request.';
comment on column public.requests.admin_decision_at is 'When the Admin made the final approve/reject call.';

-- Backfill existing rows (seeded demo data + anything reviewed before this
-- migration) so historical requests aren't left with blank timestamps.
update public.requests
  set fa_decision_at = updated_at
  where status in ('forwarded', 'approved', 'rejected') and fa_decision_at is null;

update public.requests
  set forwarded_to_admin_at = updated_at
  where status in ('forwarded', 'approved', 'rejected') and forwarded_to_admin_at is null;

update public.requests
  set admin_decision_at = updated_at
  where status in ('approved', 'rejected') and reviewed_by_mao is not null and admin_decision_at is null;

-- Admin-facing view: deliberately excludes farmer_id and every farmer
-- column, and surfaces the FA President's name instead. security_invoker
-- means it still runs under the querying user's own RLS on the underlying
-- tables (so a farmer querying it, for instance, would still only see
-- their own rows) — the column list is what keeps farmer identity out of
-- the Admin's review screen, not row visibility.
create view public.requests_for_admin_review
  with (security_invoker = true)
as
select
  r.request_id,
  r.status,
  r.quantity_requested,
  r.fa_remarks,
  r.mao_remarks,
  r.forwarded_to_admin_at,
  r.fa_decision_at,
  r.admin_decision_at,
  r.created_at,
  c.name as commodity_name,
  c.unit as commodity_unit,
  p.full_name as fa_president_name
from public.requests r
join public.commodities c on c.commodity_id = r.commodity_id
left join public.profiles p on p.id = r.reviewed_by_fa
where r.status in ('forwarded', 'approved', 'rejected');

comment on view public.requests_for_admin_review is 'Admin''s review queue and history — forwarded/decided requests only, farmer identity intentionally excluded from the column list.';

grant select on public.requests_for_admin_review to authenticated;

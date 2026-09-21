-- Distributions page gets a delete action. Deleting is a soft delete (the
-- paper's distribution_claims/audit trail should survive a delete, and
-- distribution_event_items are kept too) — the app filters is_deleted out of
-- every listing query instead of removing the row. The existing "events: MAO
-- writes" RLS policy (for all, mao_admin only) already covers writing these
-- columns, so FA President stays blocked the same way it is for status.
alter table public.distribution_events
  add column is_deleted boolean not null default false,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

create index idx_distribution_events_is_deleted on public.distribution_events (is_deleted);

-- Distributions page gets an editable status control (Scheduled -> Ongoing/
-- Cancelled -> Completed/Cancelled). Cancelled didn't exist yet; add it, and
-- track who changed the status and when for accountability. The existing
-- "events: MAO writes" RLS policy (for all, mao_admin only) already covers
-- these columns, so no policy changes are needed to keep FA President
-- read-only on status.
alter type public.distribution_status add value if not exists 'cancelled';

alter table public.distribution_events
  add column status_updated_by uuid references public.profiles (id),
  add column status_updated_at timestamptz;

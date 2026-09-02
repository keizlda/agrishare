-- program_name and funding_source already existed on distribution_events but
-- funding_source was never surfaced in the UI/API. acknowledgement_status is
-- new — tracks whether the funding source/partner has acknowledged the
-- release, separate from the event's own scheduled/ongoing/completed status.
create type public.acknowledgement_status as enum ('pending', 'acknowledged');

alter table public.distribution_events
  add column acknowledgement_status public.acknowledgement_status not null default 'pending';

-- Fix a placeholder program name ("Meghan Sponsor") that ended up in event 6
-- via manual testing — replace with a realistic program name matching the
-- pattern of the other seeded events.
update public.distribution_events
  set program_name = 'Rice Resiliency Program'
  where event_id = 6 and program_name = 'Meghan Sponsor';

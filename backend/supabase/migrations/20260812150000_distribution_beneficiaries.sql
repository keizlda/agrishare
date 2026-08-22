-- distribution_claims records exactly who received what (needed for the
-- duplicate-prevention constraint), but the intake form doesn't capture a
-- per-farmer claim for every release yet — that's a future feature. Until
-- then, "how many farmers this event served/targets" needs to be an entered
-- figure, same as the old frontend mock's `beneficiaries` field.
alter table public.distribution_events
  add column beneficiaries_count int not null default 0;

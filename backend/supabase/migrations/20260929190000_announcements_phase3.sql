-- Phase 3: distribution-linked announcements don't need a hand-written
-- body ("Additional Details" is optional for them) — only a freeform
-- "General notice" post still requires one. Relaxes the original
-- not-empty check to allow a blank body when distribution_date is set,
-- and gives the column a default so inserts can omit it entirely.
alter table public.announcements
  alter column body set default '',
  drop constraint if exists announcements_body_check;

alter table public.announcements
  add constraint announcements_body_check
  check (length(btrim(body)) > 0 or distribution_date is not null);

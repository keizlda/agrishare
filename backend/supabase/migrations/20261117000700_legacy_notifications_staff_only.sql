-- Final system check (Nov 2026): the old notifications table is readable
-- by staff only. Announcements moved to public.announcements (with its own
-- audience rules) and neither app reads this table any more, but its
-- "everyone reads" policy still let any signed-in farmer read every row.
-- The rows are kept (nothing is dropped); only who can read them changes.
drop policy if exists "notifications: everyone reads" on public.notifications;
drop policy if exists "notifications: staff reads" on public.notifications;
create policy "notifications: staff reads" on public.notifications
  for select using (public.is_staff());

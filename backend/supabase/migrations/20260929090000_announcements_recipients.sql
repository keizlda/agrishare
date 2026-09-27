-- Announcements: drop Category entirely, replace the single-choice
-- target_audience enum with a multi-select "Recipients" (Validated Farmers
-- / FA President, at least one required), and drop expiry.

-- Drop the old audience-based select policy first — it reads target_audience
-- and expires_at, both of which this migration removes.
drop policy "announcements: audience reads published" on public.announcements;

alter table public.announcements
  add column for_validated_farmers boolean not null default true,
  add column for_fa_president boolean not null default false;

-- "All Farmers" (the only value in use — 5 rows) migrates to Validated
-- Farmers, per instruction. validated_farmers_only maps the same way;
-- fa_president_only maps to the FA President recipient.
update public.announcements set
  for_validated_farmers = (target_audience in ('all_farmers', 'validated_farmers_only')),
  for_fa_president = (target_audience = 'fa_president_only');

alter table public.announcements
  add constraint announcements_recipients_check check (for_validated_farmers or for_fa_president);

-- category was never populated with anything meaningful beyond the demo
-- seed data and every consumer (form, table, mobile badges/filters) is
-- being removed in this same change, so dropping outright rather than
-- leaving a dead nullable column behind.
alter table public.announcements
  drop column category,
  drop column target_audience,
  drop column expires_at;

drop type if exists public.announcement_category;
drop type if exists public.announcement_audience;

create policy "announcements: audience reads published" on public.announcements
  for select using (
    status = 'published'
    and (
      (for_validated_farmers and public.is_validated_farmer())
      or (for_fa_president and public.current_role() = 'fa_president')
    )
  );

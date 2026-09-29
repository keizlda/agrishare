-- Converts every out-of-format RSBSA number to the official Enrollment Form
-- shape 09-73-00-000-{last 6 digits}, preserving each farmer's login ID
-- (the last 6 digits never change) with one exception:
--
-- farmer_id 2 (Juan Dela Cruz, demo/seed data, was 2024-01-002-000123) and
-- farmer_id 9 (Kryzzel Jane Balabag, was 2026-01-002-000123) both end in
-- 000123 — converting both as-is would collide. Per admin decision, farmer 2
-- gets a synthetic, non-colliding number instead (000999, not derived from
-- its old digits); farmer 9 keeps its number, and therefore its login ID,
-- unchanged.
--
-- This also unblocks something more than cosmetic: the RSBSA format check
-- constraint (NOT VALID, added earlier) applies to every UPDATE regardless
-- of which columns change, so as long as any farmer's rsbsa_no is
-- out-of-format, editing or soft-deleting that farmer fails outright.
update public.farmers
set rsbsa_no = '09-73-00-000-000999'
where farmer_id = 2;

update public.farmers
set rsbsa_no = '09-73-00-000-' || lpad(right(regexp_replace(rsbsa_no, '\D', '', 'g'), 6), 6, '0')
where farmer_id <> 2
  and rsbsa_no !~ '^\d{2}-\d{2}-\d{2}-\d{3}-\d{6}$';

-- Every row now matches the format — the constraint can finally be
-- validated for real (it already rejects any new bad value; this makes
-- Postgres confirm the existing data too).
alter table public.farmers validate constraint farmers_rsbsa_format_check;

-- Login ID (last 6 digits) partial unique index, deferred from the
-- soft-delete migration specifically because of the collision above.
create unique index farmers_login_id_active_key on public.farmers (right(rsbsa_digits, 6)) where deleted_at is null;

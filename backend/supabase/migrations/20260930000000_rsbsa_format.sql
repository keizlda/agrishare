-- Official RSBSA Enrollment Form (Revised 01-2024) format:
-- RR-PP-MM-BBB-NNNNNN (region-province-municipality-barangay-sequence).
-- Existing rows (seed data used a different 4-2-3-6 shape) won't match, so
-- this is added NOT VALID — it blocks new/updated rows from violating it,
-- but doesn't scan/fail on old ones. Once the admin has corrected every
-- flagged farmer, run:
--   alter table public.farmers validate constraint farmers_rsbsa_format_check;
alter table public.farmers
  add constraint farmers_rsbsa_format_check
  check (rsbsa_no ~ '^\d{2}-\d{2}-\d{2}-\d{3}-\d{6}$') not valid;

-- Digits-only mirror of rsbsa_no, so search can match a typed number with or
-- without hyphens without fragile string surgery in an ILIKE pattern.
alter table public.farmers
  add column rsbsa_digits text generated always as (regexp_replace(rsbsa_no, '\D', '', 'g')) stored;

create index idx_farmers_rsbsa_digits on public.farmers (rsbsa_digits);

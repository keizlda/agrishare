-- Add the two farm_parcels fields the expanded Add/Edit Farmer form needs
-- that the initial schema didn't cover yet:
--   * livestock_details — free-text note (e.g. "2 carabao, 5 goats"), no
--     structured livestock table exists, and the form doesn't need one.
--   * is_pcic_insured becomes nullable so the UI's Yes/No/Not Applicable
--     tri-state has a real "unknown/not applicable" value instead of being
--     forced into false.
alter table public.farm_parcels
  add column livestock_details text;

alter table public.farm_parcels
  alter column is_pcic_insured drop not null,
  alter column is_pcic_insured drop default;

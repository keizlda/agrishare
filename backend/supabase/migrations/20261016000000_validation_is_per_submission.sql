-- Validation applies ONLY to proof-of-planting submissions
-- (public.crop_validations.status: pending / validated / rejected). A farmer
-- is never "validated" or "pending" as a person; a farmer's own status is
-- public.farmers.status (active / inactive) only.
--
-- The farmer-level columns below were never kept up to date by either app
-- (the only writer, web's setFarmerValidation, had no callers), so every
-- farmer read "pending". As of this release the web and mobile apps no
-- longer read or write them. Per instruction they are kept, not dropped —
-- this migration only documents them as deprecated; no data or behavior
-- changes.

comment on column public.farmers.validation_status is
  'DEPRECATED (Oct 2026): unused. Validation is per proof-of-planting submission (crop_validations.status). A farmer''s own status is farmers.status (active/inactive) only.';

comment on column public.farmers.last_validation_date is
  'DEPRECATED (Oct 2026): unused. A submission''s review date is crop_validations.reviewed_at.';

comment on function public.is_validated_farmer() is
  'DEPRECATED (Oct 2026): unused since announcements moved to for_all_registered_farmers (20260929170000); reads the deprecated farmers.validation_status.';

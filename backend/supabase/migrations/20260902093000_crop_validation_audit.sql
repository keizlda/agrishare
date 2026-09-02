-- The Validation page now reviews crop_validations submissions (proof-of-
-- planting photos), separately from a farmer's Active/Inactive status. Wire
-- the same generic audit trigger already used for farmers/requests/claims so
-- a review decision (and any later, separate farmer status change) each
-- produce their own distinct audit_logs row with their own actor/timestamp.
create trigger audit_crop_validations after insert or update on public.crop_validations
  for each row execute function public.log_audit_event();

-- Final system check (Nov 2026): a farmer's proof-of-planting submission
-- always starts as Pending, with its photo in the farmer's own folder. The
-- insert policy ("crop_validations: farmer submits own") only checked
-- farmer_id, so through the API a farmer could submit a record already
-- marked "validated" (with a reviewer and review date), or point it at
-- another farmer's photo. Review fields are cleared here and a photo
-- outside the farmer's folder is refused. The app already uploads to the
-- farmer's folder and sends status "pending", so nothing changes for it.
-- remarks is kept: on a new submission it holds the farmer's own note.
create or replace function public.crop_validation_insert_defaults()
returns trigger
language plpgsql
as $$
begin
  if public.current_role() = 'farmer' then
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    if new.photo_url is not null and split_part(new.photo_url, '/', 1) <> new.farmer_id::text then
      raise exception 'The photo must be one you uploaded for this submission.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists crop_validation_insert_defaults on public.crop_validations;
create trigger crop_validation_insert_defaults before insert on public.crop_validations
  for each row execute function public.crop_validation_insert_defaults();

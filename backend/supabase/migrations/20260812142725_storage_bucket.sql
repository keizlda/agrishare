-- Storage bucket for crop validation photos (geotagged proof of planting).
-- This is the piece that solves the "ephemeral filesystem" problem flagged
-- earlier — Supabase Storage is S3-compatible and persists independently of
-- any app server, so photo uploads survive deploys/restarts.
insert into storage.buckets (id, name, public)
values ('crop-validation-photos', 'crop-validation-photos', false)
on conflict (id) do nothing;

-- Farmers can upload/view their own photos; staff can view all (for review).
-- Path convention: {farmer_id}/{validation_id}.jpg
create policy "crop photos: farmer uploads own"
  on storage.objects for insert
  with check (
    bucket_id = 'crop-validation-photos'
    and (storage.foldername(name))[1] = (select farmer_id::text from public.farmers where profile_id = auth.uid())
  );

create policy "crop photos: farmer reads own, staff reads all"
  on storage.objects for select
  using (
    bucket_id = 'crop-validation-photos'
    and (
      public.is_staff()
      or (storage.foldername(name))[1] = (select farmer_id::text from public.farmers where profile_id = auth.uid())
    )
  );

-- Final system check (Nov 2026): a farmer can see only their own profile
-- photo. "avatars: authenticated reads all" let any signed-in farmer list
-- and download every other farmer's photo through the Storage API. Staff
-- (MAO Admin, Farmers' Association President) still see every photo for the
-- farmer list and profiles; uploads, replacing and removing are unchanged.
drop policy if exists "avatars: authenticated reads all" on storage.objects;
drop policy if exists "avatars: owner or staff reads" on storage.objects;
create policy "avatars: owner or staff reads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = (auth.uid())::text or public.is_staff())
  );

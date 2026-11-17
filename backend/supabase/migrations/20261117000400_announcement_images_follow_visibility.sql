-- Final system check (Nov 2026): an announcement's image is visible to the
-- same people as the announcement. "announcement images: signed-in read"
-- let any signed-in user download every image, including those of drafts
-- and of announcements sent only to the Farmers' Association President.
-- Now an image can be read by the MAO Admin (who also needs it while
-- composing, before the announcement is saved) or by anyone who can see an
-- announcement using it — the announcements subquery runs under the
-- reader's own row rules, so drafts and FA-only notices stay hidden.
drop policy if exists "announcement images: signed-in read" on storage.objects;
drop policy if exists "announcement images: readable with the announcement" on storage.objects;
create policy "announcement images: readable with the announcement" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'announcement-images'
    and (
      public.current_role() = 'mao_admin'
      or exists (select 1 from public.announcements a where a.image_url = objects.name)
    )
  );

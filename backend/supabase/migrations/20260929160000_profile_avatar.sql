-- Profile picture upload (mobile). Neither an avatar column nor an avatars
-- storage bucket existed before this migration.

alter table public.profiles
  add column avatar_url text;

-- The blanket grant in 20260812143108_grants.sql gives `authenticated` full
-- UPDATE on profiles, and "profiles: update own row" lets a user hit their
-- own row — together that's row-level only, with no column restriction, so
-- nothing today stops a farmer from rewriting their own role/full_name. Cap
-- it to avatar_url the same way 20260926090000_user_notifications.sql capped
-- user_notifications updates to is_read/read_at — everything else on
-- profiles stays admin-only ("coordinate with your FA President or MAO"),
-- avatar_url is the sole exception.
revoke update on public.profiles from authenticated;
grant update (avatar_url) on public.profiles to authenticated;

-- Private bucket (not public) so reads stay gated to signed-in users via the
-- select policy below, matching crop-validation-photos' bucket in
-- 20260812142725_storage_bucket.sql. Path convention: {user_id}/avatar.jpg —
-- the client requests a long-lived signed URL after upload so avatar_url can
-- store a stable link instead of re-signing on every render.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "avatars: owner uploads own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: owner replaces own folder"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner deletes own folder"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: authenticated reads all"
  on storage.objects for select
  using (bucket_id = 'avatars' and auth.role() = 'authenticated');

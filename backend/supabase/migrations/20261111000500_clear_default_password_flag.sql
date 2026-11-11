-- Error-handling fix (Nov 2026): a farmer can clear their own "still on the
-- default password" flag after changing it. The app could only update
-- profiles.avatar_url (20260929160000_profile_avatar.sql), so the Home
-- reminder never went away.
create or replace function public.clear_must_change_password()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.clear_must_change_password() to authenticated;

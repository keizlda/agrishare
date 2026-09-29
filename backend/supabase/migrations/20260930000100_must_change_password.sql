-- Tracks whether a farmer is still on the default password issued at
-- account creation / reset, so the mobile app can nag them to change it.
alter table public.profiles
  add column must_change_password boolean not null default true;

-- Accounts that already existed before this feature shipped: we have no way
-- to know whether they've already changed their password, so don't nag them
-- retroactively — only accounts created/reset through manage-farmer-account
-- from this point on start out true (the column default above).
update public.profiles set must_change_password = false;

-- Announcements: admin-authored posts (category, audience, pinning, expiry,
-- optional image, draft/published) shown to farmers in the mobile app.
--
-- The old public.notifications table stays untouched. It mixed announcements
-- with distribution-linked/forwarded rows and had no audience, status or
-- ownership model, so it can't express any of this. Its plain announcement
-- rows are copied over once (see the end of this file).

create type public.announcement_category as enum ('general', 'distribution_schedule', 'validation_reminder', 'urgent');
create type public.announcement_audience as enum ('all_farmers', 'validated_farmers_only', 'fa_president_only');
create type public.announcement_status as enum ('draft', 'published');

create table public.announcements (
  announcement_id bigint generated always as identity primary key,
  title varchar(150) not null check (length(btrim(title)) > 0),
  body text not null check (length(btrim(body)) > 0),
  category public.announcement_category not null default 'general',
  target_audience public.announcement_audience not null default 'all_farmers',
  -- Path inside the private announcement-images bucket (not a public URL).
  image_url text,
  is_pinned boolean not null default false,
  status public.announcement_status not null default 'draft',
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set only on rows copied from public.notifications; makes the one-time
  -- copy idempotent and lets old read receipts be carried across.
  legacy_notification_id bigint unique
);

create index idx_announcements_feed on public.announcements (status, is_pinned desc, published_at desc);

create table public.announcement_reads (
  announcement_id bigint not null references public.announcements (announcement_id) on delete cascade,
  farmer_id bigint not null references public.farmers (farmer_id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, farmer_id)
);

-- ---------------------------------------------------------------------------
-- Timestamps: updated_at always; published_at is stamped by the database the
-- moment a post becomes Published (so re-publishing after an unpublish sorts
-- it as new), never trusted from the client.
-- ---------------------------------------------------------------------------
create or replace function public.announcements_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create trigger announcements_before_write before insert or update on public.announcements
  for each row execute function public.announcements_before_write();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
create or replace function public.is_validated_farmer()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farmers
    where profile_id = auth.uid() and validation_status = 'validated'
  )
$$;

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

-- Admin sees everything (drafts, expired, unpublished). Everyone else only
-- sees published, unexpired posts aimed at them.
create policy "announcements: admin reads all" on public.announcements
  for select using (public.current_role() = 'mao_admin');

create policy "announcements: audience reads published" on public.announcements
  for select using (
    status = 'published'
    and (expires_at is null or expires_at > now())
    and (
      (target_audience = 'all_farmers' and public.current_role() in ('farmer', 'fa_president'))
      or (target_audience = 'validated_farmers_only' and public.is_validated_farmer())
      or (target_audience = 'fa_president_only' and public.current_role() = 'fa_president')
    )
  );

create policy "announcements: admin inserts" on public.announcements
  for insert with check (public.current_role() = 'mao_admin');
create policy "announcements: admin updates" on public.announcements
  for update using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');
create policy "announcements: admin deletes" on public.announcements
  for delete using (public.current_role() = 'mao_admin');

-- Reads: a farmer records and sees only their own; admin sees all (read counts).
create policy "announcement_reads: farmer reads own, admin reads all" on public.announcement_reads
  for select using (farmer_id = public.current_farmer_id() or public.current_role() = 'mao_admin');
create policy "announcement_reads: farmer records own" on public.announcement_reads
  for insert with check (farmer_id = public.current_farmer_id());

-- ---------------------------------------------------------------------------
-- Image storage: private bucket, same signed-URL pattern as crop photos.
-- Any signed-in user may read (paths are unguessable and only reachable via
-- an announcement row the caller could already see); only admin writes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', false)
on conflict (id) do nothing;

create policy "announcement images: signed-in read" on storage.objects
  for select to authenticated
  using (bucket_id = 'announcement-images');
create policy "announcement images: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'announcement-images' and public.current_role() = 'mao_admin');
create policy "announcement images: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'announcement-images' and public.current_role() = 'mao_admin');
create policy "announcement images: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'announcement-images' and public.current_role() = 'mao_admin');

-- Realtime (the mobile app subscribes so new posts appear without a refresh).
-- Realtime evaluates the SELECT policies above per subscriber.
alter publication supabase_realtime add table public.announcements;

-- ---------------------------------------------------------------------------
-- One-time copy of legacy announcements from public.notifications.
-- Only plain announcement rows (not forwards / distribution-linked ones).
-- ---------------------------------------------------------------------------
insert into public.announcements (title, body, category, target_audience, status, published_at, created_by, created_at, legacy_notification_id)
select left(n.title, 150), n.message, 'general', 'all_farmers', 'published', n.created_at, n.created_by, n.created_at, n.notification_id
from public.notifications n
where n.parent_notification_id is null
  and n.distribution_event_id is null
  and n.is_forwarded = false
  and btrim(n.title) <> '' and btrim(n.message) <> ''
on conflict (legacy_notification_id) do nothing;

-- The insert trigger above stamps published_at = now(); restore the original
-- post dates so the copied posts keep their real ordering.
update public.announcements a
set published_at = n.created_at
from public.notifications n
where a.legacy_notification_id = n.notification_id;

-- Carry existing read receipts across (notification_reads is keyed by profile;
-- announcement_reads by farmer).
insert into public.announcement_reads (announcement_id, farmer_id, read_at)
select a.announcement_id, f.farmer_id, r.read_at
from public.notification_reads r
join public.announcements a on a.legacy_notification_id = r.notification_id
join public.farmers f on f.profile_id = r.profile_id
on conflict do nothing;

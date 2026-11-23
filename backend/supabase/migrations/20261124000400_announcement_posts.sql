-- Announcements as simple posts (Nov 24, 2026).
--
--   * A post is text (up to 2,000 characters) with an optional photo,
--     posted by "MAO Labangan" to an audience: farmers (all registered
--     farmers), fa_president (the Farmers' Association President) or
--     everyone (both). It can be pinned, edited and deleted (soft delete:
--     deleted_at; hidden from everyone, kept for the record).
--   * The old structured columns (title, distribution date/time, venue,
--     type of assistance, requirements, linked distribution) stay in place
--     but the apps no longer use them. Existing announcements get their
--     title and those fields written into the post text, so nothing is
--     lost. title is now the post's first line (kept for older readers).
--   * audience is the source of who sees a post; the old recipient
--     booleans follow it (and a forward by the Farmers' Association
--     President, which sets the farmers' boolean, makes it "everyone").
--   * Notifications: "MAO Labangan posted an announcement" with the first
--     line of the text. The "You're included" check tied to a linked
--     distribution is gone (farmers still get their own distribution
--     notifications).
--   * Photos: JPG or PNG, up to 5 MB.

alter table public.announcements add column audience text;
alter table public.announcements add column deleted_at timestamptz;

update public.announcements set audience = case
  when for_all_registered_farmers and for_fa_president then 'everyone'
  when for_fa_president then 'fa_president'
  else 'farmers'
end;
alter table public.announcements alter column audience set not null;
alter table public.announcements alter column audience set default 'farmers';
alter table public.announcements add constraint announcements_audience_check check (audience in ('farmers', 'fa_president', 'everyone'));

-- ------------------------------------- the old fields written into the text
update public.announcements a set body = concat_ws(E'\n\n',
  nullif(btrim(a.title), ''),
  nullif(btrim(a.body), ''),
  nullif(concat_ws(E'\n',
    case
      when a.distribution_date is not null then
        'Date: ' || to_char(a.distribution_date, 'FMMonth FMDD, YYYY')
          || coalesce(' · ' || ltrim(to_char(a.distribution_time, 'HH12:MI AM'), '0'), '')
      when a.distribution_time is not null then 'Time: ' || ltrim(to_char(a.distribution_time, 'HH12:MI AM'), '0')
    end,
    'Venue: ' || nullif(btrim(a.venue), ''),
    'Type of assistance: ' || nullif(btrim(a.assistance_type), ''),
    'Requirements: ' || nullif(btrim(a.requirements), '')
  ), '')
);

alter table public.announcements drop constraint announcements_body_check;
alter table public.announcements add constraint announcements_body_check
  check ((length(btrim(body)) > 0 or image_url is not null) and char_length(body) <= 2000);

-- ------------------------------------------------------------ before write
create or replace function public.announcements_before_write()
returns trigger
language plpgsql
as $$
declare
  v_first text;
begin
  new.updated_at = now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = now();
  end if;

  -- audience decides who sees it; the recipient booleans follow. A change
  -- to the booleans alone (a forward to farmers) updates the audience.
  if tg_op = 'UPDATE' and new.audience is not distinct from old.audience
     and (new.for_all_registered_farmers is distinct from old.for_all_registered_farmers
          or new.for_fa_president is distinct from old.for_fa_president) then
    new.audience := case
      when new.for_all_registered_farmers and new.for_fa_president then 'everyone'
      when new.for_fa_president then 'fa_president'
      else 'farmers'
    end;
  end if;
  new.for_all_registered_farmers := new.audience in ('farmers', 'everyone');
  new.for_fa_president := new.audience in ('fa_president', 'everyone');

  -- title: the post's first line (or "Photo" for a photo-only post).
  if tg_op = 'INSERT' or new.body is distinct from old.body then
    v_first := btrim(split_part(btrim(coalesce(new.body, '')), E'\n', 1));
    new.title := left(coalesce(nullif(v_first, ''), 'Photo'), 150);
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------- reading
drop policy if exists "announcements: audience reads published" on public.announcements;
create policy "announcements: audience reads published" on public.announcements for select
  using (
    status = 'published' and deleted_at is null and (
      (audience in ('farmers', 'everyone') and public.current_role() = 'farmer')
      or (audience in ('fa_president', 'everyone') and public.current_role() = 'fa_president')
    )
  );

-- ----------------------------------------------------------- notifications
-- The first line of a post, for notifications (at most 140 characters).
create or replace function public.post_first_line(p_body text)
returns text
language sql
immutable
as $$
  select case
    when btrim(split_part(btrim(coalesce(p_body, '')), E'\n', 1)) = '' then 'Photo'
    when char_length(btrim(split_part(btrim(p_body), E'\n', 1))) > 140 then left(btrim(split_part(btrim(p_body), E'\n', 1)), 139) || '…'
    else btrim(split_part(btrim(p_body), E'\n', 1))
  end
$$;

create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  became_published boolean;
begin
  became_published := new.status = 'published' and new.deleted_at is null
    and (tg_op = 'INSERT' or old.status is distinct from 'published');

  if became_published then
    if new.audience in ('farmers', 'everyone') then
      perform public.notify_role('farmer', 'announcement', 'MAO Labangan posted an announcement',
        public.post_first_line(new.body), '/announcements');
    end if;
    if new.audience in ('fa_president', 'everyone') then
      perform public.notify_role('fa_president', 'announcement', 'MAO Labangan posted an announcement',
        public.post_first_line(new.body), '/announcements');
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.forward_announcement_to_farmers(p_announcement_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  if public.current_role() <> 'fa_president' then
    raise exception 'Only the Farmers'' Association President can forward announcements.';
  end if;

  select * into a from public.announcements
  where announcement_id = p_announcement_id and for_fa_president = true and status = 'published' and deleted_at is null;
  if not found then
    raise exception 'Announcement not found or not available to forward.';
  end if;

  update public.announcements
  set for_all_registered_farmers = true, forwarded_by = auth.uid(), forwarded_at = now()
  where announcement_id = p_announcement_id;

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes)
  values (
    auth.uid(), 'fa_president', 'announcements', 'forward', p_announcement_id::text,
    'Forwarded announcement "' || a.title || '" to all registered farmers',
    jsonb_build_object('old', to_jsonb(a), 'new', jsonb_build_object('for_all_registered_farmers', true))
  );

  perform public.notify_role(
    'farmer', 'announcement', 'MAO Labangan posted an announcement',
    public.post_first_line(a.body), '/announcements'
  );
end;
$$;

-- ------------------------------------------------------------------ photos
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png'] where id = 'announcement-images';

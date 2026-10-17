-- Display text only: the role is now written out as "Farmers' Association
-- President" everywhere users read it. These two functions build user-facing
-- notification and error text; their logic and the fa_president role key are
-- unchanged. Notifications already sent keep the wording they had.

create or replace function public.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  commodity_name text;
begin
  select f.profile_id into farmer_profile from public.farmers f where f.farmer_id = new.farmer_id;
  select c.name into commodity_name from public.commodities c where c.commodity_id = new.commodity_id;

  if tg_op = 'INSERT' then
    perform public.notify_role(
      'fa_president', 'request', 'New commodity request',
      'A farmer requested ' || coalesce(commodity_name, 'a commodity') || '.',
      '/requests'
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'forwarded' then
      perform public.notify_role(
        'mao_admin', 'request', 'Request awaiting your review',
        'The Farmers'' Association President approved a request for ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests'
      );
    elsif new.status in ('approved', 'rejected') then
      perform public.notify_user(
        farmer_profile, 'request',
        'Your request was ' || new.status,
        'Your request for ' || coalesce(commodity_name, 'a commodity') || ' was ' || new.status || '.',
        '/requests'
      );
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
  where announcement_id = p_announcement_id and for_fa_president = true and status = 'published';
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
    'farmer', 'announcement', a.title,
    'Forwarded by your Farmers'' Association President.',
    '/announcements'
  );
end;
$$;

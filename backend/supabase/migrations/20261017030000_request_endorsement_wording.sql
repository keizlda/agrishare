-- Display text only: the Farmers' Association President endorses a request;
-- only the MAO approves or rejects it. Request notifications now say so:
--   endorsed (forwarded)                -> MAO: "... endorsed a request for ..."
--   not endorsed (rejected while pending) -> farmer: "Your request was not endorsed"
--   approved / rejected by the MAO      -> farmer: unchanged
-- Statuses, who is notified and when are unchanged. Notifications already
-- sent keep the wording they had.

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
        'The Farmers'' Association President endorsed a request for ' || coalesce(commodity_name, 'a commodity') || '.',
        '/requests'
      );
    elsif new.status = 'rejected' and old.status = 'pending' then
      perform public.notify_user(
        farmer_profile, 'request', 'Your request was not endorsed',
        'Your request for ' || coalesce(commodity_name, 'a commodity') || ' was not endorsed by your Farmers'' Association President.',
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

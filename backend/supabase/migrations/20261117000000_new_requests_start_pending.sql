-- Final system check (Nov 2026): a farmer's new commodity request always
-- starts as Pending. The insert policy ("requests: farmer creates own") only
-- checked farmer_id, so a farmer calling the API directly could create a
-- request that was already "approved" (or carried MAO remarks), skipping the
-- Farmers' Association President and the MAO. Whatever a farmer sends for
-- the status and decision fields is replaced here; the app already sends
-- only the request itself, so nothing changes for it.
create or replace function public.request_insert_defaults()
returns trigger
language plpgsql
as $$
begin
  if public.current_role() = 'farmer' then
    new.status := 'pending';
    new.fa_remarks := null;
    new.mao_remarks := null;
    new.reviewed_by_fa := null;
    new.reviewed_by_mao := null;
    new.fa_decision_at := null;
    new.forwarded_to_admin_at := null;
    new.admin_decision_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists request_insert_defaults on public.requests;
create trigger request_insert_defaults before insert on public.requests
  for each row execute function public.request_insert_defaults();

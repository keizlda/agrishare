-- Review suggestion (Nov 2026): both the MAO Admin and the Farmers'
-- Association President now see every farmer request with its full timeline
-- (submitted, endorsed / not endorsed, approved / rejected — by whom and
-- when). Reading every request was already allowed for both ("requests:
-- staff read all, farmer reads own"), and the MAO can still only decide an
-- Endorsed request ("requests: MAO approves or rejects forwarded"), so a
-- Pending request stays read-only for the MAO.
--
-- What changes: the "by whom and when" of a decision is stamped here from
-- the signed-in user and the server clock, instead of trusting what the
-- browser sends — otherwise a decision could be recorded under someone
-- else's name or a made-up date. Runs after request_decision_fields_only
-- (triggers fire in name order).
create or replace function public.request_decision_stamps()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if r = 'fa_president' then
    new.reviewed_by_fa := auth.uid();
    new.fa_decision_at := now();
    new.forwarded_to_admin_at := case when new.status = 'forwarded' then now() else null end;
  elsif r = 'mao_admin' then
    new.reviewed_by_mao := auth.uid();
    new.admin_decision_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists request_decision_stamps on public.requests;
create trigger request_decision_stamps before update on public.requests
  for each row execute function public.request_decision_stamps();

-- Final system check (Nov 2026): deciding on a request changes only the
-- decision. The update policies let the Farmers' Association President move
-- a Pending request to Endorsed/Not endorsed and the MAO Admin decide an
-- Endorsed one, but RLS can't limit columns: through the API the FA
-- President could also change the farmer, commodity, quantity or the MAO's
-- remarks while endorsing. This trigger refuses changes to anything but
-- each role's own decision fields. (The web app already sends only these.)
-- The message (SQLSTATE P0001) is shown as written.
create or replace function public.request_decision_fields_only()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
  allowed text[];
begin
  if r = 'fa_president' then
    allowed := array['status', 'fa_remarks', 'reviewed_by_fa', 'fa_decision_at', 'forwarded_to_admin_at', 'updated_at'];
  elsif r = 'mao_admin' then
    allowed := array['status', 'mao_remarks', 'reviewed_by_mao', 'admin_decision_at', 'updated_at'];
  else
    return new;
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Only the decision and its remarks can be changed on a request.';
  end if;
  return new;
end;
$$;

drop trigger if exists request_decision_fields_only on public.requests;
create trigger request_decision_fields_only before update on public.requests
  for each row execute function public.request_decision_fields_only();

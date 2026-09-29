-- record_id priority bug: farmer_id was checked before claim_id, so
-- distribution_claims rows (which have both a claim_id PK and a farmer_id
-- FK) logged the farmer's id instead of the claim's. Table's own PK column
-- now wins for every table that has one in this list.
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec_id text;
  old_data jsonb;
  new_data jsonb;
  actor_role public.user_role;
begin
  old_data := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_data := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  rec_id := coalesce(
    (new_data ->> 'claim_id'), (old_data ->> 'claim_id'),
    (new_data ->> 'event_id'), (old_data ->> 'event_id'),
    (new_data ->> 'event_item_id'), (old_data ->> 'event_item_id'),
    (new_data ->> 'request_id'), (old_data ->> 'request_id'),
    (new_data ->> 'commodity_id'), (old_data ->> 'commodity_id'),
    (new_data ->> 'announcement_id'), (old_data ->> 'announcement_id'),
    (new_data ->> 'farmer_id'), (old_data ->> 'farmer_id')
  );
  select role into actor_role from public.profiles where id = auth.uid();

  insert into public.audit_logs (actor_id, user_role, table_name, action, record_id, summary, changes, details)
  values (
    auth.uid(), actor_role, TG_TABLE_NAME, lower(TG_OP), rec_id,
    initcap(TG_OP) || ' on ' || TG_TABLE_NAME || coalesce(' (id ' || rec_id || ')', ''),
    jsonb_build_object('old', old_data, 'new', new_data),
    coalesce(new_data, old_data)
  );
  return coalesce(new, old);
end;
$$;

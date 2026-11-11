-- Error-handling fix (Nov 2026): the FA President may only change a
-- farmer's Active/Inactive status (paper Use Case "Mark Farmer Active or
-- Inactive"). The row policy for it ("fa_president: toggle farmer status
-- only") only stopped RSBSA changes — RLS can't limit columns — so names,
-- birth date, contact number and the rest could be edited through the API.
-- This trigger refuses a change to any other column.
--
-- rsbsa_digits is a generated column: in a BEFORE trigger NEW doesn't have
-- its value yet, so it's left out of the comparison (rsbsa_no is compared).
-- The message (SQLSTATE P0001) is shown as written.
create or replace function public.fa_president_status_only()
returns trigger
language plpgsql
as $$
begin
  if public.current_role() = 'fa_president'
     and (to_jsonb(new) - 'status' - 'updated_at' - 'rsbsa_digits')
         is distinct from (to_jsonb(old) - 'status' - 'updated_at' - 'rsbsa_digits') then
    raise exception 'The Farmers'' Association President can only change a farmer''s Active/Inactive status.';
  end if;
  return new;
end;
$$;

drop trigger if exists fa_president_status_only on public.farmers;
create trigger fa_president_status_only before update on public.farmers
  for each row execute function public.fa_president_status_only();

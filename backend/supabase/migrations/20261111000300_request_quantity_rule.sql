-- Error-handling fix (Nov 2026): a new commodity request must ask for more
-- than 0. A trigger rather than a CHECK constraint, so existing requests
-- (whatever they hold) can still be endorsed, approved or rejected.
--
-- The message (SQLSTATE P0001) is shown to the farmer as written.
create or replace function public.check_request_quantity()
returns trigger
language plpgsql
as $$
begin
  if new.quantity_requested is null or new.quantity_requested <= 0 then
    raise exception 'Enter a quantity greater than 0.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_request_quantity on public.requests;
create trigger check_request_quantity before insert on public.requests
  for each row execute function public.check_request_quantity();

-- Final system check (Nov 2026): only the MAO Admin can run the duplicate-
-- distribution lookup. find_duplicate_distribution runs with the owner's
-- rights (it has to see every claim) but checked nothing about the caller,
-- so any signed-in farmer could ask whether another farmer received a
-- commodity, from which program, when, and how much. It's only used while
-- the MAO Admin tags beneficiaries; for anyone else it now returns nothing.
create or replace function public.find_duplicate_distribution(
  p_farmer_id bigint,
  p_commodity_id bigint,
  p_program_name text,
  p_year integer,
  p_exclude_event_id bigint default null
)
returns table (event_id bigint, program_name text, event_date date, quantity_received numeric)
language sql
stable
security definer
set search_path = public
as $$
  select e.event_id, e.program_name, e.event_date, c.quantity_received
  from public.distribution_claims c
  join public.distribution_events e on e.event_id = c.event_id
  where public.current_role() = 'mao_admin'
    and c.farmer_id = p_farmer_id
    and c.commodity_id = p_commodity_id
    and lower(e.program_name) = lower(p_program_name)
    and extract(year from e.event_date) = p_year
    and e.is_deleted = false
    and (p_exclude_event_id is null or e.event_id <> p_exclude_event_id)
  order by e.event_date desc
  limit 1
$$;

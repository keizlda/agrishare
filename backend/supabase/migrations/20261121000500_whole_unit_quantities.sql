-- Quantities of things that can't be split — sets, pieces, heads, bags,
-- sacks (also "unit" and "pack") — must be whole numbers: a farmer can't get
-- 11.5 sets. kg, L and other measured units keep 2 decimals. The apps check
-- this too (and split totals in whole units: 23 sets for 2 farmers → 12 and
-- 11); this makes the rule hold for anything written through the API.
--
-- Rows already saved are left as they are: the check runs only when a
-- quantity is entered or changed (or moved to another commodity).

create or replace function public.is_whole_unit(p_unit text)
returns boolean
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_unit, '')), '\.$', '')) = any (array[
    'set', 'sets', 'pc', 'pcs', 'piece', 'pieces', 'head', 'heads',
    'bag', 'bags', 'sack', 'sacks', 'unit', 'units', 'pack', 'packs'
  ])
$$;

-- Farm size × allocation per hectare: whole units round to a whole number
-- (and a cap per farmer counts whole units only); others to 2 decimals.
create or replace function public.commodity_allocation(p_commodity_id bigint, p_farm_size numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when c.allocation_per_hectare is null or p_farm_size is null then null
    when public.is_whole_unit(c.unit) then
      least(round(p_farm_size * c.allocation_per_hectare, 0),
            coalesce(floor(c.max_per_farmer), round(p_farm_size * c.allocation_per_hectare, 0)))
    else round(least(p_farm_size * c.allocation_per_hectare, coalesce(c.max_per_farmer, p_farm_size * c.allocation_per_hectare)), 2)
  end
  from public.commodities c
  where c.commodity_id = p_commodity_id
$$;

-- TG_ARGV[0]: the quantity column. The message (SQLSTATE P0001) is shown as
-- written.
create or replace function public.check_whole_unit_quantity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_qty numeric := (to_jsonb(new) ->> tg_argv[0])::numeric;
  v_unit text;
begin
  if v_qty is null or v_qty = trunc(v_qty) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_qty = (to_jsonb(old) ->> tg_argv[0])::numeric
     and new.commodity_id is not distinct from old.commodity_id then
    return new;
  end if;
  -- Saving a distribution re-writes every tagged farmer with INSERT … ON
  -- CONFLICT, which runs this as an insert even for a farmer whose saved
  -- quantity isn't changing: that one is left alone too.
  if tg_op = 'INSERT' and tg_table_name = 'distribution_claims' then
    if exists (
      select 1 from public.distribution_claims c
      where c.event_id = (to_jsonb(new) ->> 'event_id')::bigint
        and c.commodity_id = new.commodity_id
        and c.farmer_id = (to_jsonb(new) ->> 'farmer_id')::bigint
        and c.quantity_received = v_qty
    ) then
      return new;
    end if;
  end if;
  select unit into v_unit from public.commodities where commodity_id = new.commodity_id;
  if public.is_whole_unit(v_unit) then
    raise exception 'Enter whole numbers for %: it can''t be split.', v_unit;
  end if;
  return new;
end;
$$;

drop trigger if exists check_whole_unit_quantity on public.distribution_claims;
create trigger check_whole_unit_quantity before insert or update on public.distribution_claims
  for each row execute function public.check_whole_unit_quantity('quantity_received');

drop trigger if exists check_whole_unit_quantity on public.distribution_event_items;
create trigger check_whole_unit_quantity before insert or update on public.distribution_event_items
  for each row execute function public.check_whole_unit_quantity('quantity_allocated');

drop trigger if exists check_whole_unit_quantity on public.requests;
create trigger check_whole_unit_quantity before insert on public.requests
  for each row execute function public.check_whole_unit_quantity('quantity_requested');

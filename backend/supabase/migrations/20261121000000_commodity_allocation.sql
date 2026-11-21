-- Review suggestion (Nov 2026): a commodity can carry an allocation per
-- hectare, a pack size (e.g. 20 kg per bag) and a cap per farmer, so a
-- distribution can compute each farmer's quantity from their farm size
-- (farm size × allocation per hectare, capped, rounded to 2 decimals). All
-- three are optional; a commodity without a rate keeps the equal split.
alter table public.commodities
  add column if not exists allocation_per_hectare numeric(10, 2),
  add column if not exists pack_size numeric(10, 2),
  add column if not exists max_per_farmer numeric(10, 2);

alter table public.commodities
  add constraint commodities_allocation_positive check (allocation_per_hectare is null or allocation_per_hectare > 0),
  add constraint commodities_pack_size_positive check (pack_size is null or pack_size > 0),
  add constraint commodities_max_per_farmer_positive check (max_per_farmer is null or max_per_farmer > 0);

comment on column public.commodities.allocation_per_hectare is 'Quantity (in the commodity''s unit) per hectare of farm size.';
comment on column public.commodities.pack_size is 'Quantity per pack/bag, for showing bags next to the quantity.';
comment on column public.commodities.max_per_farmer is 'Optional cap on one farmer''s computed quantity.';

-- Starting rates (editable later on the Commodities page). Only commodities
-- that don't have a rate yet are touched.
-- Inbred rice seeds (e.g. "Rice Seeds (NSIC Rc222)"): 40 kg/ha, 20 kg bags.
update public.commodities
set allocation_per_hectare = 40, pack_size = 20
where category = 'Rice' and deleted_at is null and allocation_per_hectare is null
  and name ilike '%seed%' and name not ilike '%hybrid%';

-- Hybrid rice seeds: 15 kg/ha.
update public.commodities
set allocation_per_hectare = 15
where category = 'Rice' and deleted_at is null and allocation_per_hectare is null
  and name ilike '%hybrid%';

insert into public.commodities (name, category, unit, allocation_per_hectare)
select 'Hybrid Rice Seeds', 'Rice', 'kg', 15
where not exists (
  select 1 from public.commodities
  where deleted_at is null and category = 'Rice' and name ilike '%hybrid%'
);

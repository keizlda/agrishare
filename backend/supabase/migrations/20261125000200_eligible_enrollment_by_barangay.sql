-- "Add all eligible farmers" by barangay (Nov 25, 2026).
--
-- A seed program counts only enrolled farmers once anyone is enrolled in it;
-- otherwise it counts farmers growing the commodity's crop. With
-- distributions per barangay, "anyone enrolled" has to mean anyone in that
-- barangay: farmers in Langapod enrolled in Corn Seeds shouldn't leave
-- Bokong's corn growers out of a Bokong distribution.

create or replace function public.distribution_eligible_farmers(p_commodity_id bigint, p_program_name text, p_year integer, p_exclude_event_id bigint default null::bigint, p_barangay_id bigint default null::bigint)
 returns table(farmer_id bigint, rsbsa_no text, first_name text, surname text, barangay text, sitio_purok text, crop_type text, farm_size_hectares numeric, avatar_url text, seed_program_id bigint, duplicate_program text, duplicate_date date, duplicate_quantity numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with enrolled as (
    select exists (
      select 1 from public.farmers x
      where x.seed_program_id = p_commodity_id and x.deleted_at is null and x.status = 'active'
        and (p_barangay_id is null or public.farmer_barangay_id(x.farmer_id) = p_barangay_id)
    ) as any_enrolled
  )
  select f.farmer_id, f.rsbsa_no, f.first_name, f.surname,
         coalesce(addr.barangay, ''), addr.street,
         crop.crop_type, public.farmer_farm_size(f.farmer_id), p.avatar_url, f.seed_program_id,
         dup.program_name, dup.event_date, dup.quantity_received
  from public.farmers f
  cross join enrolled
  join public.commodities c on c.commodity_id = p_commodity_id
  left join lateral (
    select a.barangay, a.street from public.addresses a where a.farmer_id = f.farmer_id limit 1
  ) addr on true
  left join lateral (
    select cr.crop_type from public.farm_parcels fp join public.crops cr on cr.parcel_id = fp.parcel_id
    where fp.farmer_id = f.farmer_id order by fp.parcel_id limit 1
  ) crop on true
  left join public.profiles p on p.id = f.profile_id
  left join lateral (
    select * from public.find_duplicate_distribution(f.farmer_id, p_commodity_id, p_program_name, p_year, p_exclude_event_id)
  ) dup on nullif(btrim(coalesce(p_program_name, '')), '') is not null
  where public.current_role() = 'mao_admin'
    and (p_barangay_id is null or public.farmer_barangay_id(f.farmer_id) = p_barangay_id)
    and f.deleted_at is null
    and f.status = 'active'
    and case when enrolled.any_enrolled then f.seed_program_id = p_commodity_id
             else lower(btrim(crop.crop_type)) = lower(btrim(c.category)) end
  order by f.surname, f.first_name
$function$;

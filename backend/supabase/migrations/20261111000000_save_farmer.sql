-- Error-handling fix (Nov 2026): a farmer is saved in one transaction, so a
-- dropped connection or a failing step can't leave a farmer without an
-- address or farm. It also repeats the web form's input rules, so a request
-- that skips the form gets the same plain-English answer.
--
-- Messages raised here (RAISE EXCEPTION, SQLSTATE P0001) are shown to the
-- user as written — see friendlyError in web/src/lib and mobile/src/lib.
--
-- save_farmer(p_farmer_id, p_farmer): farmer + address + farm parcel + crop.
-- p_farmer_id null = new farmer. Returns the farmer_id.
create or replace function public.save_farmer(p_farmer_id bigint, p_farmer jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
  v_parcel bigint;
  v_birth date;
  v_size numeric;
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only the MAO Admin can register or edit farmers.';
  end if;
  if btrim(coalesce(p_farmer ->> 'first_name', '')) = '' or btrim(coalesce(p_farmer ->> 'surname', '')) = '' then
    raise exception 'First name and last name are required.';
  end if;
  v_birth := nullif(p_farmer ->> 'birth_date', '')::date;
  if v_birth is null or v_birth > current_date then
    raise exception 'Enter a realistic birth date — not in the future.';
  end if;
  v_size := nullif(p_farmer ->> 'farm_size_hectares', '')::numeric;
  if v_size is null or v_size <= 0 then
    raise exception 'Farm size must be greater than 0.';
  end if;

  if p_farmer_id is null then
    insert into public.farmers (
      rsbsa_no, surname, first_name, middle_name, sex, birth_date, contact_no, org_affiliation, status
    ) values (
      btrim(p_farmer ->> 'rsbsa_no'), btrim(p_farmer ->> 'surname'), btrim(p_farmer ->> 'first_name'),
      nullif(btrim(p_farmer ->> 'middle_name'), ''), (p_farmer ->> 'sex')::public.sex_type, v_birth,
      p_farmer ->> 'contact_no', nullif(btrim(p_farmer ->> 'org_affiliation'), ''),
      coalesce(p_farmer ->> 'status', 'active')::public.farmer_status
    )
    returning farmer_id into v_id;

    insert into public.addresses (farmer_id, street, barangay, municipality, province)
    values (v_id, nullif(btrim(p_farmer ->> 'street'), ''), p_farmer ->> 'barangay', p_farmer ->> 'municipality', p_farmer ->> 'province');

    insert into public.farm_parcels (farmer_id, farm_location, farm_size_hectares, ownership_type, is_pcic_insured)
    values (v_id, nullif(btrim(p_farmer ->> 'farm_location'), ''), v_size, nullif(p_farmer ->> 'ownership_type', ''),
            (p_farmer ->> 'is_pcic_insured')::boolean)
    returning parcel_id into v_parcel;

    insert into public.crops (parcel_id, crop_type, area_planted)
    values (v_parcel, p_farmer ->> 'crop_type', v_size);
    return v_id;
  end if;

  update public.farmers set
    rsbsa_no = btrim(p_farmer ->> 'rsbsa_no'),
    surname = btrim(p_farmer ->> 'surname'),
    first_name = btrim(p_farmer ->> 'first_name'),
    middle_name = nullif(btrim(p_farmer ->> 'middle_name'), ''),
    sex = (p_farmer ->> 'sex')::public.sex_type,
    birth_date = v_birth,
    contact_no = p_farmer ->> 'contact_no',
    org_affiliation = nullif(btrim(p_farmer ->> 'org_affiliation'), ''),
    status = coalesce(p_farmer ->> 'status', 'active')::public.farmer_status
  where farmer_id = p_farmer_id and deleted_at is null
  returning farmer_id into v_id;
  if v_id is null then
    raise exception 'That farmer record no longer exists — refresh and try again.';
  end if;

  update public.addresses set
    street = nullif(btrim(p_farmer ->> 'street'), ''),
    barangay = p_farmer ->> 'barangay',
    municipality = p_farmer ->> 'municipality',
    province = p_farmer ->> 'province'
  where farmer_id = v_id;
  if not found then
    insert into public.addresses (farmer_id, street, barangay, municipality, province)
    values (v_id, nullif(btrim(p_farmer ->> 'street'), ''), p_farmer ->> 'barangay', p_farmer ->> 'municipality', p_farmer ->> 'province');
  end if;

  -- The form edits the farmer's first parcel and its first crop; any other
  -- parcels (from the full RSBSA record) are left as they are.
  select parcel_id into v_parcel from public.farm_parcels where farmer_id = v_id order by parcel_no, parcel_id limit 1;
  if v_parcel is null then
    insert into public.farm_parcels (farmer_id, farm_location, farm_size_hectares, ownership_type, is_pcic_insured)
    values (v_id, nullif(btrim(p_farmer ->> 'farm_location'), ''), v_size, nullif(p_farmer ->> 'ownership_type', ''),
            (p_farmer ->> 'is_pcic_insured')::boolean)
    returning parcel_id into v_parcel;
  else
    update public.farm_parcels set
      farm_location = nullif(btrim(p_farmer ->> 'farm_location'), ''),
      farm_size_hectares = v_size,
      ownership_type = nullif(p_farmer ->> 'ownership_type', ''),
      is_pcic_insured = (p_farmer ->> 'is_pcic_insured')::boolean
    where parcel_id = v_parcel;
  end if;

  update public.crops set crop_type = p_farmer ->> 'crop_type', area_planted = v_size
  where crop_id = (select crop_id from public.crops where parcel_id = v_parcel order by crop_id limit 1);
  if not found then
    insert into public.crops (parcel_id, crop_type, area_planted) values (v_parcel, p_farmer ->> 'crop_type', v_size);
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_farmer(bigint, jsonb) from public, anon;
grant execute on function public.save_farmer(bigint, jsonb) to authenticated;

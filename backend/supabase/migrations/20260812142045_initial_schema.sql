-- AgriShare initial schema
-- Maps to the ERD in Chapter 3.3.2 of the paper, adapted for Supabase:
--   * auth.users (built-in) replaces tbl_Users; public.profiles extends it with role
--   * tbl_MAO / tbl_FA_President collapse into profiles.role (no separate tables needed —
--     role-specific fields, if any emerge later, can live in dedicated tables keyed on profiles.id)
--   * tbl_Distributions is expanded into three tables (events / event_items / claims) —
--     the paper's own DFD and FRs both say the system must "prevent duplicate distributions",
--     which is only enforceable with a real per-farmer claim row + a unique constraint, not a
--     single aggregate "beneficiaries: 120" counter.

-- ============================================================================
-- 1. Enums
-- ============================================================================
create type public.user_role as enum ('mao_admin', 'fa_president', 'farmer');
create type public.farmer_status as enum ('active', 'inactive');
create type public.validation_status as enum ('validated', 'pending', 'not_validated');
create type public.distribution_status as enum ('scheduled', 'ongoing', 'completed');
create type public.request_status as enum ('pending', 'forwarded', 'approved', 'rejected');
create type public.crop_validation_status as enum ('pending', 'validated', 'rejected');
create type public.sex_type as enum ('male', 'female');

-- ============================================================================
-- 2. Profiles (extends auth.users with role + display info)
-- ============================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  full_name text not null,
  contact_no text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Extends auth.users with AgriShare role. One row per login account (MAO admin, FA President, or Farmer).';

-- auto-create a profile row whenever a new auth.users row is inserted, reading
-- role/full_name out of the signup call's user_metadata (set by the client).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, contact_no)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'farmer'),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'contact_no'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 3. Farmers (tbl_Farmers) + Addresses + Farm Parcels + Crops
-- ============================================================================
create table public.farmers (
  farmer_id bigint generated always as identity primary key,
  profile_id uuid unique references public.profiles (id) on delete set null,
  rsbsa_no text not null unique,
  surname text not null,
  first_name text not null,
  middle_name text,
  extension_name text,
  sex public.sex_type not null,
  birth_date date not null,
  birth_place text,
  contact_no text,
  civil_status text,
  religion text,
  indigenous_group text,
  household_head boolean not null default false,
  household_members int,
  female_members int,
  is_4ps_beneficiary boolean not null default false,
  org_affiliation text,
  status public.farmer_status not null default 'active',
  validation_status public.validation_status not null default 'pending',
  last_validation_date date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.farmers is 'Farmer beneficiary profile. rsbsa_no is unique — the first line of defense against duplicate registration.';

create index idx_farmers_status on public.farmers (status);
create index idx_farmers_validation_status on public.farmers (validation_status);

create table public.addresses (
  address_id bigint generated always as identity primary key,
  farmer_id bigint not null references public.farmers (farmer_id) on delete cascade,
  house_no text,
  street text,
  barangay text not null default 'Langapud',
  municipality text not null default 'Labangan',
  province text not null default 'Zamboanga del Sur',
  zipcode text
);

create table public.farm_parcels (
  parcel_id bigint generated always as identity primary key,
  farmer_id bigint not null references public.farmers (farmer_id) on delete cascade,
  parcel_no int not null default 1,
  farm_location text,
  farm_size_hectares numeric(10, 2),
  ownership_type text,
  is_organic_practitioner boolean not null default false,
  is_agrarian_reform_beneficiary boolean not null default false,
  is_pcic_insured boolean not null default false
);

create table public.crops (
  crop_id bigint generated always as identity primary key,
  parcel_id bigint not null references public.farm_parcels (parcel_id) on delete cascade,
  crop_type text not null,
  commodity_category text,
  area_planted numeric(10, 2),
  cropping_schedule text
);

-- ============================================================================
-- 4. Commodities (tbl_Commodities)
-- Deliberately has no stock/on-hand quantity column — inventory monitoring and
-- forecasting are explicitly out of scope per the paper (Limitations 1.5.2).
-- "Total distributed" is always computed from distribution_claims, never stored.
-- ============================================================================
create table public.commodities (
  commodity_id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  unit text not null default 'kg',
  status public.farmer_status not null default 'active',
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 5. Distributions: event -> offered items -> individual farmer claims
-- ============================================================================
create table public.distribution_events (
  event_id bigint generated always as identity primary key,
  program_name text not null,
  event_date date not null,
  venue text,
  barangay text not null default 'Langapud',
  funding_source text,
  status public.distribution_status not null default 'scheduled',
  remarks text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.distribution_event_items (
  event_item_id bigint generated always as identity primary key,
  event_id bigint not null references public.distribution_events (event_id) on delete cascade,
  commodity_id bigint not null references public.commodities (commodity_id),
  quantity_allocated numeric(12, 2) not null,
  unique (event_id, commodity_id)
);

create table public.distribution_claims (
  claim_id bigint generated always as identity primary key,
  event_id bigint not null references public.distribution_events (event_id) on delete cascade,
  commodity_id bigint not null references public.commodities (commodity_id),
  farmer_id bigint not null references public.farmers (farmer_id),
  quantity_received numeric(12, 2) not null,
  acknowledged boolean not null default false,
  released_by uuid references public.profiles (id),
  claimed_at timestamptz not null default now(),
  -- The actual enforcement of "prevent duplicate distributions" (paper FR,
  -- Use Case Diagram, DFD 2.3): a farmer cannot claim the same commodity
  -- twice within the same distribution event.
  unique (event_id, commodity_id, farmer_id)
);

comment on table public.distribution_claims is 'One row per farmer per commodity per event. The unique constraint is what actually prevents duplicate distributions — a UI check alone cannot guarantee this under concurrent access.';

create index idx_claims_farmer on public.distribution_claims (farmer_id);
create index idx_claims_event on public.distribution_claims (event_id);

-- ============================================================================
-- 6. Commodity Requests (tbl_Requests) — farmer -> FA President -> MAO Admin
-- ============================================================================
create table public.requests (
  request_id bigint generated always as identity primary key,
  farmer_id bigint not null references public.farmers (farmer_id),
  commodity_id bigint not null references public.commodities (commodity_id),
  quantity_requested numeric(12, 2) not null,
  reason text,
  status public.request_status not null default 'pending',
  fa_remarks text,
  mao_remarks text,
  reviewed_by_fa uuid references public.profiles (id),
  reviewed_by_mao uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_requests_status on public.requests (status);
create index idx_requests_farmer on public.requests (farmer_id);

-- ============================================================================
-- 7. Notifications / Announcements (tbl_Notifications)
-- ============================================================================
create table public.notifications (
  notification_id bigint generated always as identity primary key,
  parent_notification_id bigint references public.notifications (notification_id),
  title text not null,
  message text not null,
  distribution_event_id bigint references public.distribution_events (event_id),
  created_by uuid references public.profiles (id),
  is_forwarded boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.notification_reads (
  notification_id bigint not null references public.notifications (notification_id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  archived boolean not null default false,
  primary key (notification_id, profile_id)
);

-- ============================================================================
-- 8. Crop Validation (tbl_Crop_Validation) — geotagged proof of planting
-- ============================================================================
create table public.crop_validations (
  validation_id bigint generated always as identity primary key,
  farmer_id bigint not null references public.farmers (farmer_id),
  crop_id bigint references public.crops (crop_id),
  distribution_claim_id bigint references public.distribution_claims (claim_id),
  photo_url text,
  latitude numeric(10, 6),
  longitude numeric(10, 6),
  gps_accuracy_meters numeric(6, 2),
  captured_at timestamptz,
  status public.crop_validation_status not null default 'pending',
  remarks text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 9. Audit Logs (tbl_Audit_Logs)
-- ============================================================================
create table public.audit_logs (
  log_id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  table_name text not null,
  action text not null,
  record_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_table on public.audit_logs (table_name, record_id);

-- generic audit trigger: logs insert/update/delete on any table it's attached to
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec_id text;
  row_data jsonb;
begin
  row_data := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rec_id := coalesce(
    row_data ->> 'farmer_id',
    row_data ->> 'request_id',
    row_data ->> 'claim_id'
  );
  insert into public.audit_logs (actor_id, table_name, action, record_id, details)
  values (auth.uid(), TG_TABLE_NAME, TG_OP, rec_id, row_data);
  return coalesce(new, old);
end;
$$;

create trigger audit_farmers after insert or update or delete on public.farmers
  for each row execute function public.log_audit_event();
create trigger audit_distribution_claims after insert or update or delete on public.distribution_claims
  for each row execute function public.log_audit_event();
create trigger audit_requests after insert or update or delete on public.requests
  for each row execute function public.log_audit_event();

-- ============================================================================
-- 10. updated_at maintenance
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.farmers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.requests
  for each row execute function public.set_updated_at();

-- Farmers are never hard-deleted anymore — distribution_claims/requests/
-- crop_validations all reference farmer_id with no cascade (on purpose:
-- distribution history must survive), which is exactly why "Delete" was
-- failing with a foreign key violation. Soft delete instead: the row (and
-- every table that references it) stays put, just marked removed.
alter table public.farmers
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

-- RSBSA number and login ID (its last 6 digits) only need to be unique
-- among ACTIVE farmers — a farmer deleted by mistake can be re-added under
-- the same RSBSA number without colliding with their own deleted row.
-- Looked up by column rather than assumed name, so this doesn't depend on
-- guessing whatever Postgres auto-named the original `unique` constraint.
do $$
declare
  cons_name text;
begin
  select conname into cons_name
  from pg_constraint
  where conrelid = 'public.farmers'::regclass
    and contype = 'u'
    and conkey = array(
      select attnum from pg_attribute
      where attrelid = 'public.farmers'::regclass and attname = 'rsbsa_no'
    );
  if cons_name is not null then
    execute format('alter table public.farmers drop constraint %I', cons_name);
  end if;
end $$;

create unique index farmers_rsbsa_no_active_key on public.farmers (rsbsa_no) where deleted_at is null;

-- Login ID (last 6 digits) partial unique index is added in a follow-up
-- migration once the pending RSBSA format conversion resolves a real
-- existing collision (two farmers whose numbers already end the same way)
-- — adding it here would fail the same way right now.

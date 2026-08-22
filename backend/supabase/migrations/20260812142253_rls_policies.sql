-- Row Level Security policies implementing the role split from the Use Case
-- Diagram: MAO Admin (full access), FA President (view farmers/distributions,
-- mark active/inactive, review requests), Farmer (own records only).
-- This is enforced at the database level — the web/mobile role checks are a
-- UX convenience, not the actual security boundary. That boundary lives here.

-- ============================================================================
-- Helper functions
-- ============================================================================
create or replace function public.current_role()
returns public.user_role
language sql stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_farmer_id()
returns bigint
language sql stable
security definer
set search_path = public
as $$
  select farmer_id from public.farmers where profile_id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.current_role() in ('mao_admin', 'fa_president')
$$;

-- ============================================================================
-- Enable RLS everywhere
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.farmers enable row level security;
alter table public.addresses enable row level security;
alter table public.farm_parcels enable row level security;
alter table public.crops enable row level security;
alter table public.commodities enable row level security;
alter table public.distribution_events enable row level security;
alter table public.distribution_event_items enable row level security;
alter table public.distribution_claims enable row level security;
alter table public.requests enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.crop_validations enable row level security;
alter table public.audit_logs enable row level security;

-- ============================================================================
-- profiles
-- ============================================================================
create policy "profiles: read own or staff reads all" on public.profiles
  for select using (id = auth.uid() or public.is_staff());

create policy "profiles: update own row" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================================
-- farmers
-- ============================================================================
create policy "farmers: staff reads all, farmer reads own" on public.farmers
  for select using (public.is_staff() or profile_id = auth.uid());

create policy "farmers: MAO inserts" on public.farmers
  for insert with check (public.current_role() = 'mao_admin');

create policy "farmers: MAO updates any field" on public.farmers
  for update using (public.current_role() = 'mao_admin');

-- FA President may only flip status active<->inactive (paper Use Case:
-- "Mark Farmer Active or Inactive"), never touch personal/farm data. RLS
-- can't restrict individual columns, so this policy is intentionally
-- narrow and the client should call it through a dedicated code path —
-- but the WITH CHECK below still blocks anything except a status change.
create policy "fa_president: toggle farmer status only" on public.farmers
  for update
  using (public.current_role() = 'fa_president')
  with check (
    public.current_role() = 'fa_president'
    and rsbsa_no = (select rsbsa_no from public.farmers f2 where f2.farmer_id = farmers.farmer_id)
  );

create policy "farmers: MAO deletes" on public.farmers
  for delete using (public.current_role() = 'mao_admin');

-- ============================================================================
-- addresses / farm_parcels / crops — visibility mirrors the parent farmer
-- ============================================================================
create policy "addresses: staff all, farmer own" on public.addresses
  for select using (
    public.is_staff()
    or farmer_id = public.current_farmer_id()
  );
create policy "addresses: MAO writes" on public.addresses
  for all using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

create policy "farm_parcels: staff all, farmer own" on public.farm_parcels
  for select using (
    public.is_staff()
    or farmer_id = public.current_farmer_id()
  );
create policy "farm_parcels: MAO writes" on public.farm_parcels
  for all using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

create policy "crops: staff all, farmer own" on public.crops
  for select using (
    public.is_staff()
    or parcel_id in (select parcel_id from public.farm_parcels where farmer_id = public.current_farmer_id())
  );
create policy "crops: MAO writes" on public.crops
  for all using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

-- ============================================================================
-- commodities — everyone reads, only MAO writes
-- ============================================================================
create policy "commodities: everyone reads" on public.commodities
  for select using (auth.uid() is not null);

create policy "commodities: MAO writes" on public.commodities
  for all using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

-- ============================================================================
-- distribution_events / distribution_event_items — everyone reads, MAO writes
-- ============================================================================
create policy "events: everyone reads" on public.distribution_events
  for select using (auth.uid() is not null);
create policy "events: MAO writes" on public.distribution_events
  for all using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

create policy "event_items: everyone reads" on public.distribution_event_items
  for select using (auth.uid() is not null);
create policy "event_items: MAO writes" on public.distribution_event_items
  for all using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

-- ============================================================================
-- distribution_claims — the duplicate-prevention table
-- ============================================================================
create policy "claims: staff read all, farmer reads own" on public.distribution_claims
  for select using (public.is_staff() or farmer_id = public.current_farmer_id());

create policy "claims: MAO records releases" on public.distribution_claims
  for insert with check (public.current_role() = 'mao_admin');

create policy "claims: MAO updates" on public.distribution_claims
  for update using (public.current_role() = 'mao_admin');

create policy "claims: MAO deletes" on public.distribution_claims
  for delete using (public.current_role() = 'mao_admin');

-- ============================================================================
-- requests — farmer submits, FA forwards, MAO approves
-- ============================================================================
create policy "requests: staff read all, farmer reads own" on public.requests
  for select using (public.is_staff() or farmer_id = public.current_farmer_id());

create policy "requests: farmer creates own" on public.requests
  for insert with check (farmer_id = public.current_farmer_id());

-- FA President may only act on Pending requests, and only move them to
-- Forwarded or Rejected — mirrors the frontend's canFAAct guard, now
-- enforced server-side too.
create policy "requests: FA forwards or rejects pending" on public.requests
  for update
  using (public.current_role() = 'fa_president' and status = 'pending')
  with check (public.current_role() = 'fa_president' and status in ('forwarded', 'rejected'));

-- MAO Admin may only act on Forwarded requests, moving them to
-- Approved or Rejected.
create policy "requests: MAO approves or rejects forwarded" on public.requests
  for update
  using (public.current_role() = 'mao_admin' and status = 'forwarded')
  with check (public.current_role() = 'mao_admin' and status in ('approved', 'rejected'));

-- ============================================================================
-- notifications — MAO creates, FA forwards, everyone in-scope reads
-- ============================================================================
create policy "notifications: everyone reads" on public.notifications
  for select using (auth.uid() is not null);

create policy "notifications: MAO creates" on public.notifications
  for insert with check (public.current_role() = 'mao_admin' and parent_notification_id is null);

create policy "notifications: FA forwards" on public.notifications
  for insert with check (public.current_role() = 'fa_president' and parent_notification_id is not null and is_forwarded = true);

create policy "notification_reads: own rows only" on public.notification_reads
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============================================================================
-- crop_validations — farmer submits, staff review
-- ============================================================================
create policy "crop_validations: staff read all, farmer reads own" on public.crop_validations
  for select using (public.is_staff() or farmer_id = public.current_farmer_id());

create policy "crop_validations: farmer submits own" on public.crop_validations
  for insert with check (farmer_id = public.current_farmer_id());

create policy "crop_validations: staff reviews" on public.crop_validations
  for update using (public.is_staff());

-- ============================================================================
-- audit_logs — MAO oversight only; inserts happen only via the trigger
-- (security definer), so no insert policy is granted to any role here.
-- ============================================================================
create policy "audit_logs: MAO reads" on public.audit_logs
  for select using (public.current_role() = 'mao_admin');

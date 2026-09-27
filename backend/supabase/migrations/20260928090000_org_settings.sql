-- Settings > General Information used to be pure decoration (uncontrolled
-- inputs with hardcoded defaultValues, a Save button that only flipped a
-- 2-second "Saved!" label). This gives it somewhere real to persist to.
--
-- Single-row table (the `id boolean` + check pins it to exactly one row —
-- this is org-wide config, not per-user) rather than a client-only
-- localStorage stand-in like usePersistedState uses for report history:
-- unlike that history log, this is real admin-managed data an LGU office
-- would expect to see the same on any device, and the backend already
-- exists for everything else in this app.
create table public.org_settings (
  id boolean primary key default true,
  lgu_name text not null default 'Municipality of Labangan',
  system_name text not null default 'AgriShare - LGU Resource Management System',
  address text not null default 'Barangay Langapud, Labangan, Zamboanga del Sur',
  contact_number text not null default '0939 297 9198',
  email text not null default 'mao.labangan@example.gov.ph',
  fiscal_year text not null default '2024',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint org_settings_singleton check (id)
);

insert into public.org_settings (id) values (true);

create trigger set_updated_at before update on public.org_settings
  for each row execute function public.set_updated_at();

alter table public.org_settings enable row level security;

create policy "org_settings: everyone reads" on public.org_settings
  for select using (auth.uid() is not null);

create policy "org_settings: MAO writes" on public.org_settings
  for update using (public.current_role() = 'mao_admin') with check (public.current_role() = 'mao_admin');

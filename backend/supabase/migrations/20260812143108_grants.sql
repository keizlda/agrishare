-- Supabase's standard roles (anon, authenticated, service_role) don't get
-- automatic access to tables created in hand-written migrations the way they
-- would via the dashboard UI. RLS policies alone aren't enough — Postgres
-- checks table-level GRANTs first, then RLS filters rows on top of that.
-- service_role has BYPASSRLS, so granting it access here is what lets admin
-- scripts (like the seed script) and the Django-equivalent service layer work;
-- anon/authenticated still go through the RLS policies from the prior migration.
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;

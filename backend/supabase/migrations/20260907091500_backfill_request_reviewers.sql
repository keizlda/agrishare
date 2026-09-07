-- The original demo seed (seed.mjs) set fa_remarks/mao_remarks text on
-- requests but never reviewed_by_fa/reviewed_by_mao, so the previous
-- migration's admin_decision_at backfill (which keys off reviewed_by_mao)
-- left already-approved/rejected demo rows looking like Admin never
-- touched them. Backfill the reviewer ids from role, then the timestamp.
update public.requests
  set reviewed_by_fa = (select id from public.profiles where role = 'fa_president' limit 1)
  where status in ('forwarded', 'approved', 'rejected') and reviewed_by_fa is null;

update public.requests
  set reviewed_by_mao = (select id from public.profiles where role = 'mao_admin' limit 1)
  where status in ('approved', 'rejected') and reviewed_by_mao is null;

update public.requests
  set admin_decision_at = updated_at
  where status in ('approved', 'rejected') and reviewed_by_mao is not null and admin_decision_at is null;

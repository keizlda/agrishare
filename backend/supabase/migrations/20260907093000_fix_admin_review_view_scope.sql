-- requests_for_admin_review previously matched on status in ('forwarded',
-- 'approved', 'rejected'), which wrongly included requests the FA
-- President rejected directly (status='rejected' but never forwarded) —
-- those never reach Admin and shouldn't appear in Admin's queue at all.
-- forwarded_to_admin_at is only ever set on FA *approval*, so it's the
-- correct predicate: a request is in Admin's world once forwarded_to_admin_at
-- is set, regardless of what status it's since moved to.
create or replace view public.requests_for_admin_review
  with (security_invoker = true)
as
select
  r.request_id,
  r.status,
  r.quantity_requested,
  r.fa_remarks,
  r.mao_remarks,
  r.forwarded_to_admin_at,
  r.fa_decision_at,
  r.admin_decision_at,
  r.created_at,
  c.name as commodity_name,
  c.unit as commodity_unit,
  p.full_name as fa_president_name
from public.requests r
join public.commodities c on c.commodity_id = r.commodity_id
left join public.profiles p on p.id = r.reviewed_by_fa
where r.forwarded_to_admin_at is not null;

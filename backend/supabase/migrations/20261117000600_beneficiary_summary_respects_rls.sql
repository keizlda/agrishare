-- Final system check (Nov 2026): distribution_beneficiary_summary follows
-- the claims' own row rules. The view ran with its owner's rights, so any
-- signed-in farmer — and anyone with the public anon key, without logging
-- in — could read every distribution's tagged count and total quantity.
-- With security_invoker the MAO Admin and Farmers' Association President
-- (who read all claims) see the same totals as before; a farmer sees only
-- their own; signed-out visitors can't read it at all.
alter view public.distribution_beneficiary_summary set (security_invoker = true);
revoke select on public.distribution_beneficiary_summary from anon;

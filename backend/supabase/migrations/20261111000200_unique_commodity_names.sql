-- Error-handling fix (Nov 2026): no two active commodities with the same
-- name (case and surrounding spaces ignored); a deleted commodity's name can
-- be reused. Skipped, with a notice, if duplicates already exist — rename or
-- delete them, then create the index by hand.
do $$
begin
  if exists (
    select 1 from public.commodities where deleted_at is null
    group by lower(btrim(name)) having count(*) > 1
  ) then
    raise notice 'Duplicate active commodity names exist; commodities_active_name_key was not created.';
  else
    create unique index if not exists commodities_active_name_key
      on public.commodities (lower(btrim(name))) where deleted_at is null;
  end if;
end;
$$;

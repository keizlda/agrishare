-- Error-handling fix (Nov 2026): only the MAO Admin can validate or reject
-- proof of planting — matching the web app, where the Validation page is
-- MAO-only. Any staff account (including the FA President) could do it
-- through the API.
drop policy if exists "crop_validations: staff reviews" on public.crop_validations;
create policy "crop_validations: MAO reviews" on public.crop_validations
  for update using (public.current_role() = 'mao_admin');

-- Commodities can now be "deleted" even while used in distribution history:
-- soft delete instead of a hard row delete, so distribution_event_items,
-- distribution_claims and requests keep a real row to join against (their
-- names still show in old records/reports) while the commodity disappears
-- from every picker for new selections.
--
-- No RLS change: "commodities: everyone reads" already lets any signed-in
-- user read a commodity row (needed so joins from old distributions/requests
-- still resolve a deleted commodity's name), and "commodities: MAO writes"
-- (for all -> mao_admin) already restricts this UPDATE to admins, which is
-- also what the soft-delete write goes through — FA President's write is
-- already blocked by that same policy. "Hidden from every picker" is an
-- app-layer concern (listCommodities() filters deleted_at is null), not a
-- row-visibility one, since visibility must stay for the join case above.
alter table public.commodities
  add column deleted_at timestamptz;

create index idx_commodities_deleted_at on public.commodities (deleted_at) where deleted_at is not null;

comment on column public.commodities.deleted_at is 'Soft delete marker. Non-null = hidden from every picker/listing, but the row (and its name) stays for historical distribution/request records to join against.';

-- No existing unique constraint on commodities.name to convert to a partial
-- index — there isn't one in the schema, so a deleted name can already be
-- reused for a new commodity without any further change here.

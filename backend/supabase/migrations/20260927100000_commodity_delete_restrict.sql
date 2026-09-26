-- Commodities can now be deleted from the admin UI, but a commodity that any
-- distribution item, claim or request points at must never disappear (it would
-- orphan the distribution record). The three foreign keys were plain
-- NO ACTION (which also blocks, but is deferrable and easy to loosen by
-- accident); make the rule explicit and immediate with ON DELETE RESTRICT.
-- Deleting stays admin-only via the existing "commodities: MAO writes" RLS
-- policy (for all -> mao_admin), so no policy change is needed.
alter table public.distribution_event_items
  drop constraint distribution_event_items_commodity_id_fkey,
  add constraint distribution_event_items_commodity_id_fkey
    foreign key (commodity_id) references public.commodities (commodity_id) on delete restrict;

alter table public.distribution_claims
  drop constraint distribution_claims_commodity_id_fkey,
  add constraint distribution_claims_commodity_id_fkey
    foreign key (commodity_id) references public.commodities (commodity_id) on delete restrict;

alter table public.requests
  drop constraint requests_commodity_id_fkey,
  add constraint requests_commodity_id_fkey
    foreign key (commodity_id) references public.commodities (commodity_id) on delete restrict;

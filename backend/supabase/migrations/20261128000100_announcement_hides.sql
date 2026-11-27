-- Farmers can delete an announcement from their own app (Nov 28, 2026).
--
-- "Delete" in the farmer app removes the post for that farmer only: it is
-- recorded here and their list leaves it out. The post itself stays for
-- everyone else (and for the MAO Admin), and "Undo" puts it back.

create table public.announcement_hides (
  announcement_id bigint not null references public.announcements (announcement_id) on delete cascade,
  farmer_id bigint not null references public.farmers (farmer_id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (announcement_id, farmer_id)
);
create index announcement_hides_farmer on public.announcement_hides (farmer_id);

alter table public.announcement_hides enable row level security;

-- Each farmer sees, adds and removes only their own.
create policy "announcement_hides: farmer reads own"
  on public.announcement_hides for select
  using (farmer_id = public.current_farmer_id());
create policy "announcement_hides: farmer deletes a post for themselves"
  on public.announcement_hides for insert
  with check (farmer_id = public.current_farmer_id());
create policy "announcement_hides: farmer undoes it"
  on public.announcement_hides for delete
  using (farmer_id = public.current_farmer_id());

revoke all on public.announcement_hides from anon, authenticated;
grant select, insert, delete on public.announcement_hides to authenticated;

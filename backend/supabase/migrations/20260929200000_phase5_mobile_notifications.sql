-- Phase 5 (mobile): in-app notifications for (1) being tagged in an
-- upcoming/ongoing distribution, (2) a distribution completing or a
-- beneficiary being marked received, (3) an announcement being published
-- or forwarded. No push/SMS/email — stated study limitation.

-- 'announcement' is a new notification type; forward_announcement_to_farmers
-- (Phase 1) already calls notify_role(..., 'announcement', ...), which until
-- now would have failed the check constraint the moment anyone forwarded a
-- post — this was never actually exercised end-to-end before Phase 5.
alter table public.user_notifications drop constraint user_notifications_type_check;
alter table public.user_notifications add constraint user_notifications_type_check
  check (type in ('validated', 'rejected', 'validation', 'request', 'distribution', 'announcement', 'system'));

-- ---------------------------------------------------------------------------
-- save_distribution_beneficiaries: switch from delete-then-reinsert to an
-- upsert that only removes chips actually dropped during this edit. A farmer
-- who stays tagged across saves now keeps the same claim row (and its
-- notified_at), which is what makes the "only notify once" trigger below
-- actually work — the old delete+reinsert destroyed and recreated every
-- row on every save, so an INSERT trigger would have re-fired for every
-- already-tagged farmer on every unrelated edit (e.g. changing the venue).
-- ---------------------------------------------------------------------------
create or replace function public.save_distribution_beneficiaries(
  p_event_id bigint,
  p_commodity_id bigint,
  p_beneficiaries jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b jsonb;
  incoming_farmer_ids bigint[];
begin
  if public.current_role() <> 'mao_admin' then
    raise exception 'Only MAO Admin can tag distribution beneficiaries.';
  end if;

  select coalesce(array_agg((elem ->> 'farmer_id')::bigint), '{}')
    into incoming_farmer_ids
    from jsonb_array_elements(p_beneficiaries) elem;

  delete from public.distribution_claims
  where event_id = p_event_id
    and commodity_id = p_commodity_id
    and not (farmer_id = any (incoming_farmer_ids));

  for b in select * from jsonb_array_elements(p_beneficiaries) loop
    insert into public.distribution_claims (
      event_id, commodity_id, farmer_id, quantity_received,
      acknowledgement_status, acknowledged_at, duplicate_override_reason, released_by
    ) values (
      p_event_id, p_commodity_id, (b ->> 'farmer_id')::bigint, (b ->> 'quantity_received')::numeric,
      coalesce((b ->> 'acknowledgement_status')::public.beneficiary_acknowledgement_status, 'pending'),
      case when (b ->> 'acknowledgement_status') = 'received' then now() else null end,
      nullif(b ->> 'duplicate_override_reason', ''), auth.uid()
    )
    on conflict (event_id, commodity_id, farmer_id) do update set
      quantity_received = excluded.quantity_received,
      acknowledgement_status = excluded.acknowledgement_status,
      acknowledged_at = case
        when excluded.acknowledgement_status = 'received' and distribution_claims.acknowledgement_status <> 'received'
          then now()
        when excluded.acknowledgement_status = 'received'
          then distribution_claims.acknowledged_at
        else null
      end,
      duplicate_override_reason = excluded.duplicate_override_reason,
      released_by = excluded.released_by;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Tagged in an upcoming/ongoing distribution — fires once per farmer per
-- distribution+commodity, on the genuinely-new insert the upsert above now
-- produces (an already-tagged farmer being resaved goes through the UPDATE
-- branch instead, which this trigger ignores).
-- ---------------------------------------------------------------------------
create or replace function public.notify_distribution_claim_tagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  event_status public.distribution_status;
  event_program text;
begin
  if new.notified_at is not null then
    return new;
  end if;

  select status, program_name into event_status, event_program
    from public.distribution_events where event_id = new.event_id;

  if event_status in ('scheduled', 'ongoing') then
    select profile_id into farmer_profile from public.farmers where farmer_id = new.farmer_id;
    perform public.notify_user(
      farmer_profile, 'distribution', 'You''re listed in an upcoming distribution',
      'You were tagged in ' || coalesce(event_program, 'a distribution') || '. Check My Distributions for details.',
      '/my-distributions'
    );
  end if;

  update public.distribution_claims set notified_at = now() where claim_id = new.claim_id;
  return new;
end;
$$;

create trigger notify_distribution_claim_tagged
  after insert on public.distribution_claims
  for each row execute function public.notify_distribution_claim_tagged();

-- ---------------------------------------------------------------------------
-- 2a) A distribution is marked Completed — tell every farmer tagged in it.
-- ---------------------------------------------------------------------------
create or replace function public.notify_distribution_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.user_notifications (user_id, type, title, message, link)
    select f.profile_id, 'distribution', 'Distribution completed',
           coalesce(new.program_name, 'A distribution') || ' has been completed. Open My Distributions to see what you received.',
           '/my-distributions'
    from public.distribution_claims c
    join public.farmers f on f.farmer_id = c.farmer_id
    where c.event_id = new.event_id and f.profile_id is not null;
  end if;
  return new;
end;
$$;

create trigger notify_distribution_completed
  after update on public.distribution_events
  for each row execute function public.notify_distribution_completed();

-- ---------------------------------------------------------------------------
-- 2b) A beneficiary's own acknowledgement is marked Received (MAO's toggle
-- or "Mark all as received").
-- ---------------------------------------------------------------------------
create or replace function public.notify_beneficiary_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farmer_profile uuid;
  event_program text;
begin
  if new.acknowledgement_status = 'received' and old.acknowledgement_status is distinct from 'received' then
    select profile_id into farmer_profile from public.farmers where farmer_id = new.farmer_id;
    select program_name into event_program from public.distribution_events where event_id = new.event_id;
    perform public.notify_user(
      farmer_profile, 'distribution', 'Marked as received',
      'You were marked as received for ' || coalesce(event_program, 'a distribution') || '.',
      '/my-distributions'
    );
  end if;
  return new;
end;
$$;

create trigger notify_beneficiary_received
  after update on public.distribution_claims
  for each row execute function public.notify_beneficiary_received();

-- ---------------------------------------------------------------------------
-- 3) Announcement published or forwarded. Forwarding already notifies from
-- inside forward_announcement_to_farmers (Phase 1) — this covers the
-- publish step (draft -> published, or created already published),
-- respecting whichever recipients were actually checked.
-- ---------------------------------------------------------------------------
create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  became_published boolean;
begin
  became_published := new.status = 'published'
    and (tg_op = 'INSERT' or old.status is distinct from 'published');

  if became_published then
    if new.for_all_registered_farmers then
      perform public.notify_role('farmer', 'announcement', 'New announcement: ' || new.title,
        'Open Announcements to read the full post.', '/announcements');
    end if;
    if new.for_fa_president then
      perform public.notify_role('fa_president', 'announcement', 'New announcement: ' || new.title,
        'Open Announcements to read the full post.', '/announcements');
    end if;
  end if;
  return new;
end;
$$;

create trigger notify_announcement_published
  after insert or update on public.announcements
  for each row execute function public.notify_announcement_published();

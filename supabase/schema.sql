-- Parking App schema — run in the Supabase SQL editor.
-- One reservation per space per day, and one space per user per day (enforced by the DB, so races are safe).

create table if not exists public.parking_spaces (
  id          smallint primary key,
  label       text not null,
  sort_order  smallint not null default 0,
  active      boolean not null default true
);

create table if not exists public.reservations (
  id                uuid primary key default gen_random_uuid(),
  space_id          smallint not null references public.parking_spaces(id) on delete cascade,
  reserved_for      date not null,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_name         text not null,
  user_avatar_url   text,
  created_at        timestamptz not null default now(),
  constraint one_reservation_per_space_per_day unique (space_id, reserved_for),
  constraint one_space_per_user_per_day      unique (user_id, reserved_for)
);

alter table public.parking_spaces enable row level security;
alter table public.reservations   enable row level security;

-- Signed-in users can see all spaces and today's shared state.
drop policy if exists "spaces readable" on public.parking_spaces;
create policy "spaces readable" on public.parking_spaces
  for select to authenticated using (true);

drop policy if exists "reservations readable" on public.reservations;
create policy "reservations readable" on public.reservations
  for select to authenticated using (true);

-- Users can only create / cancel their own reservations, and not in the past.
drop policy if exists "reserve for self" on public.reservations;
create policy "reserve for self" on public.reservations
  for insert to authenticated
  with check (user_id = auth.uid() and reserved_for >= current_date);

drop policy if exists "cancel own" on public.reservations;
create policy "cancel own" on public.reservations
  for delete to authenticated using (user_id = auth.uid());

-- Realtime: push changes to every open app instantly.
alter table public.reservations replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.reservations;
exception when duplicate_object then null; end $$;

-- Sample spaces — edit to match your lot.
insert into public.parking_spaces (id, label, sort_order) values
  (1, 'P1', 1), (2, 'P2', 2), (3, 'P3', 3), (4, 'P4', 4),
  (5, 'P5', 5), (6, 'P6', 6), (7, 'P7', 7), (8, 'P8', 8)
on conflict (id) do nothing;

-- ============================================================================
-- Roles / admin (safe to re-run)
-- Roles live in their own table that clients can READ (own rows) but never WRITE:
-- there are no insert/update/delete policies, so only the SQL editor / service role
-- can grant roles. Every admin action re-checks the role in the database.
-- ============================================================================

do $$ begin
  create type public.app_role as enum ('admin');   -- extend later: alter type public.app_role add value 'manager';
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.app_role not null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;

drop policy if exists "read own roles" on public.user_roles;
create policy "read own roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

-- Roles to grant by email, applied when that person signs in with Google (now or later).
-- Not exposed to clients at all (RLS on, no policies).
create table if not exists public.role_grants_by_email (
  email  text not null check (email = lower(email)),
  role   public.app_role not null,
  primary key (email, role)
);
alter table public.role_grants_by_email enable row level security;

insert into public.role_grants_by_email (email, role) values
  ('matishw@gmail.com', 'admin'),
  ('wenatal@gmail.com', 'admin')
on conflict do nothing;

-- True when the CURRENT user has the role. security definer so RLS on user_roles can't interfere;
-- it only ever looks at auth.uid(), so it can't be used to probe other users.
create or replace function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role = r) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_role('admin') $$;

revoke all on function public.has_role(public.app_role) from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Grants the email-listed roles to a user, but only through a verified *Google* identity, and only
-- if the account has no other sign-in method. Anyone can sign up with email+password claiming an
-- arbitrary address (email confirmation is off for username accounts), so the email alone proves nothing.
create or replace function public.apply_role_grants(p_user_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.user_roles (user_id, role)
  select i.user_id, g.role
  from auth.identities i
  join public.role_grants_by_email g on g.email = lower(i.identity_data->>'email')
  where i.user_id = p_user_id
    and i.provider = 'google'
    and coalesce((i.identity_data->>'email_verified')::boolean, false)
    and not exists (select 1 from auth.identities o where o.user_id = p_user_id and o.provider <> 'google')
  on conflict do nothing
$$;
revoke all on function public.apply_role_grants(uuid) from public, anon, authenticated;

create or replace function public.on_identity_created()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform public.apply_role_grants(new.user_id); return new; end $$;

drop trigger if exists apply_role_grants on auth.identities;
create trigger apply_role_grants after insert on auth.identities
  for each row execute function public.on_identity_created();

-- Users who already signed in before this script ran.
select public.apply_role_grants(id) from auth.users;

-- ============================================================================
-- Admin: manage parking spaces
-- ============================================================================

-- New spaces get their id automatically (existing deployments created id without a default).
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'parking_spaces'
                   and column_name = 'id' and is_identity = 'YES') then
    alter table public.parking_spaces alter column id add generated by default as identity;
  end if;
end $$;
select setval(pg_get_serial_sequence('public.parking_spaces', 'id'),
              coalesce((select max(id) from public.parking_spaces), 0) + 1, false);

-- No duplicates, ignoring case and surrounding spaces ("p9 " = "P9").
create unique index if not exists parking_spaces_label_unique on public.parking_spaces (lower(btrim(label)));

-- Admins may also write the table directly (e.g. future edit/disable features). Regular users can't.
drop policy if exists "admins manage spaces" on public.parking_spaces;
create policy "admins manage spaces" on public.parking_spaces
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Adds a space (or re-activates a disabled one with the same label). Validation lives here so it
-- can't be skipped by calling the API directly.
create or replace function public.admin_add_parking_space(p_label text)
returns public.parking_spaces language plpgsql security definer set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_space public.parking_spaces;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add parking spaces.' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'Enter a parking space number or name.' using errcode = '22023';
  end if;
  if char_length(v_label) > 20 then
    raise exception 'Use 20 characters or fewer.' using errcode = '22023';
  end if;

  select * into v_space from public.parking_spaces where lower(btrim(label)) = lower(v_label) for update;
  if found then
    if v_space.active then
      raise exception 'Parking space % already exists.', v_space.label using errcode = '23505';
    end if;
    update public.parking_spaces set active = true where id = v_space.id returning * into v_space;
    return v_space;
  end if;

  insert into public.parking_spaces (label, sort_order)
  values (v_label, coalesce((select max(sort_order) from public.parking_spaces), 0) + 1)
  returning * into v_space;
  return v_space;
exception when unique_violation then
  raise exception 'Parking space % already exists.', v_label using errcode = '23505';
end $$;
revoke all on function public.admin_add_parking_space(text) from public, anon;
grant execute on function public.admin_add_parking_space(text) to authenticated;

-- Push space changes to open apps so a newly added space shows up for everyone right away.
do $$ begin
  alter publication supabase_realtime add table public.parking_spaces;
exception when duplicate_object then null; end $$;

-- Removes a space for users. It's a soft delete (active = false): a hard delete would cascade and erase
-- the space's reservation history. Today's and future bookings on it are cancelled, since the space
-- no longer exists for them. Adding the same label again re-activates it.
create or replace function public.admin_remove_parking_space(p_space_id smallint)
returns public.parking_spaces language plpgsql security definer set search_path = ''
as $$
declare
  v_space public.parking_spaces;
begin
  if not public.is_admin() then
    raise exception 'Only admins can remove parking spaces.' using errcode = '42501';
  end if;

  update public.parking_spaces set active = false
  where id = p_space_id and active
  returning * into v_space;
  if not found then
    raise exception 'This parking space was already removed.' using errcode = 'P0002';
  end if;

  delete from public.reservations where space_id = p_space_id and reserved_for >= current_date;
  return v_space;
end $$;
revoke all on function public.admin_remove_parking_space(smallint) from public, anon;
grant execute on function public.admin_remove_parking_space(smallint) to authenticated;

-- ============================================================================
-- Daily reset at 20:00 UTC (pg_cron) — safe to re-run
-- ============================================================================

-- Resets the lot to exactly the listed spaces, all free:
--   * listed spaces are created or re-activated (matched by label, ignoring case/spaces) and ordered as listed;
--   * every other space is soft-deleted (active = false), like an admin "Remove" — rows are kept so
--     reservation history stays intact;
--   * reservations from today (UTC) onward are deleted so every space can be booked again; past days are kept.
-- Idempotent: the unique label index prevents duplicates, and a transaction-scoped advisory lock stops
-- two runs (e.g. cron + a manual run) from interleaving. Returns a summary that pg_cron logs.
create or replace function public.daily_parking_reset()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_labels constant text[] := array['126', '127', '155', '212', '217', '239'];
  v_deactivated int;
  v_cancelled int;
begin
  perform pg_advisory_xact_lock(hashtext('public.daily_parking_reset'));

  insert into public.parking_spaces (label, sort_order, active)
  select l.label, l.pos, true
  from unnest(v_labels) with ordinality as l(label, pos)
  on conflict ((lower(btrim(label)))) do update
    set active = true, sort_order = excluded.sort_order;

  update public.parking_spaces set active = false
  where active and lower(btrim(label)) <> all (v_labels);
  get diagnostics v_deactivated = row_count;

  delete from public.reservations where reserved_for >= current_date;
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('spaces', v_labels, 'deactivated', v_deactivated, 'reservations_cleared', v_cancelled);
end $$;
-- Server-only: not callable from the app (run it manually from the SQL editor if needed).
revoke all on function public.daily_parking_reset() from public, anon, authenticated;

-- pg_cron runs jobs in the database itself, so the reset needs no open app, user or external server.
-- Its schedule is in UTC (Supabase's pg_cron timezone is GMT), so "0 20 * * *" = 20:00 UTC every day.
-- Scheduling under an existing job name replaces that job, so re-running this doesn't create duplicates.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('daily-parking-reset', '0 20 * * *', 'select public.daily_parking_reset()');

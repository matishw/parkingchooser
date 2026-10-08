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

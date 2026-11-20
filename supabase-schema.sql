create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  place_id text not null,
  rating smallint not null check (rating between 1 and 5),
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now()
);

alter table public.ratings enable row level security;

grant select, insert on public.ratings to anon;

drop policy if exists "Anyone can read ratings" on public.ratings;
create policy "Anyone can read ratings"
  on public.ratings
  for select
  to anon
  using (true);

drop policy if exists "Anyone can submit valid ratings" on public.ratings;
create policy "Anyone can submit valid ratings"
  on public.ratings
  for insert
  to anon
  with check (
    rating between 1 and 5
    and char_length(note) <= 240
    and length(btrim(place_id)) > 0
  );

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  type text not null check (type in (
    'Sidewalk blocked',
    'Construction or detour',
    'Curb ramp issue',
    'Elevator out of service',
    'Other access barrier'
  )),
  location text not null default 'Pinned map location' check (char_length(location) <= 100),
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours')
);

create index if not exists reports_expires_at_idx on public.reports (expires_at);

alter table public.reports enable row level security;

grant select, insert on public.reports to anon;

drop policy if exists "Anyone can read active reports" on public.reports;
create policy "Anyone can read active reports"
  on public.reports
  for select
  to anon
  using (expires_at > now());

drop policy if exists "Anyone can submit short-lived reports" on public.reports;
create policy "Anyone can submit short-lived reports"
  on public.reports
  for insert
  to anon
  with check (
    expires_at > now()
    and expires_at <= now() + interval '72 hours'
  );

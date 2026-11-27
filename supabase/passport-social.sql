-- Trip Passport · friends' atlas, postcards, group trips (run once in Supabase → SQL Editor → Run)
-- Needs the friends upgrade (passport-friends.sql) first. Safe to run twice.

-- 1. Each person's public travel card (countries, dates; spends only if they allow it)
create table if not exists public.shared_atlas (
  email text primary key default lower(auth.jwt() ->> 'email'),
  name text not null default '',
  visible boolean not null default true,
  card jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.shared_atlas enable row level security;
drop policy if exists "read friends cards" on public.shared_atlas;
drop policy if exists "write own card" on public.shared_atlas;
drop policy if exists "update own card" on public.shared_atlas;
drop policy if exists "delete own card" on public.shared_atlas;
create policy "read friends cards" on public.shared_atlas for select to authenticated
  using (public.is_member() and (visible or email = lower(auth.jwt() ->> 'email')));
create policy "write own card" on public.shared_atlas for insert to authenticated
  with check (public.is_member() and email = lower(auth.jwt() ->> 'email'));
create policy "update own card" on public.shared_atlas for update to authenticated
  using (email = lower(auth.jwt() ->> 'email')) with check (public.is_member() and email = lower(auth.jwt() ->> 'email'));
create policy "delete own card" on public.shared_atlas for delete to authenticated
  using (email = lower(auth.jwt() ->> 'email'));
grant select, insert, update, delete on public.shared_atlas to authenticated;
revoke all on public.shared_atlas from anon;

-- 2. Postcards between passports
create table if not exists public.postcards (
  id bigserial primary key,
  from_email text not null default lower(auth.jwt() ->> 'email'),
  from_name text not null default '',
  to_email text not null,
  iso text not null,
  body text not null check (char_length(body) between 1 and 400),
  opened boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.postcards enable row level security;
drop policy if exists "see my postcards" on public.postcards;
drop policy if exists "send postcards" on public.postcards;
drop policy if exists "open my postcards" on public.postcards;
drop policy if exists "delete my postcards" on public.postcards;
create policy "see my postcards" on public.postcards for select to authenticated
  using (to_email = lower(auth.jwt() ->> 'email') or from_email = lower(auth.jwt() ->> 'email'));
create policy "send postcards" on public.postcards for insert to authenticated
  with check (public.is_member() and from_email = lower(auth.jwt() ->> 'email')
    and exists (select 1 from public.shared_atlas a where a.email = lower(to_email) and a.visible));
create policy "open my postcards" on public.postcards for update to authenticated
  using (to_email = lower(auth.jwt() ->> 'email')) with check (to_email = lower(auth.jwt() ->> 'email'));
create policy "delete my postcards" on public.postcards for delete to authenticated
  using (to_email = lower(auth.jwt() ->> 'email') or from_email = lower(auth.jwt() ->> 'email'));
grant select, insert, update, delete on public.postcards to authenticated;
grant usage on sequence public.postcards_id_seq to authenticated;
revoke all on public.postcards from anon;

select 'social ready' as status;

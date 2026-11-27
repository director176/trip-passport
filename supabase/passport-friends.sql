-- Trip Passport · friends upgrade (run once in Supabase → SQL Editor → New query → Run)
-- Each person (or family) gets a private "space". Your existing data stays in your space.
-- Safe to run twice.

-- 1. Invite list: who may open a passport, which space they belong to, monthly plan-read cap
alter table public.members add column if not exists space text;
alter table public.members add column if not exists plan_cap int not null default 5;
alter table public.members add column if not exists added_at timestamptz not null default now();
update public.members set space = 'home-' || substr(md5('director@nayashgroup.com'), 1, 12) where space is null;
alter table public.members alter column space set default gen_random_uuid()::text;
alter table public.members alter column space set not null;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'director@nayashgroup.com'
$$;
create or replace function public.my_space() returns text
language sql stable security definer set search_path = public as $$
  select m.space from public.members m where lower(m.email) = lower(auth.jwt() ->> 'email')
$$;
create or replace function public.my_cap() returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 100000
    else coalesce((select m.plan_cap from public.members m where lower(m.email) = lower(auth.jwt() ->> 'email')), 0) end
$$;

-- 2. Every stamp belongs to a space
alter table public.docs add column if not exists space text;
update public.docs set space = (select m.space from public.members m where lower(m.email) = 'director@nayashgroup.com') where space is null;
alter table public.docs alter column space set default public.my_space();
alter table public.docs alter column space set not null;
alter table public.docs drop constraint if exists docs_pkey;
alter table public.docs add primary key (space, path);

drop policy if exists "members read"   on public.docs;
drop policy if exists "members insert" on public.docs;
drop policy if exists "members update" on public.docs;
drop policy if exists "members delete" on public.docs;
create policy "members read"   on public.docs for select to authenticated using (public.is_member() and space = public.my_space());
create policy "members insert" on public.docs for insert to authenticated with check (public.is_member() and space = public.my_space());
create policy "members update" on public.docs for update to authenticated using (public.is_member() and space = public.my_space()) with check (public.is_member() and space = public.my_space());
create policy "members delete" on public.docs for delete to authenticated using (public.is_member() and space = public.my_space());

-- 3. Only you manage the invite list
drop policy if exists "admin manages members" on public.members;
create policy "admin manages members" on public.members for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.members to authenticated;

-- 4. Plan-reader usage (for the monthly cap)
create table if not exists public.plan_uses (
  id bigserial primary key,
  email text not null default lower(auth.jwt() ->> 'email'),
  at timestamptz not null default now()
);
alter table public.plan_uses enable row level security;
drop policy if exists "own uses read" on public.plan_uses;
drop policy if exists "own uses add" on public.plan_uses;
create policy "own uses read" on public.plan_uses for select to authenticated using (email = lower(auth.jwt() ->> 'email'));
create policy "own uses add"  on public.plan_uses for insert to authenticated with check (email = lower(auth.jwt() ->> 'email'));
grant select, insert on public.plan_uses to authenticated;
grant usage on sequence public.plan_uses_id_seq to authenticated;
revoke all on public.plan_uses from anon;

grant execute on function public.is_admin(), public.my_space(), public.my_cap() to authenticated;

-- Check: your stamps are all in your space (expect one row with your count)
select space, count(*) as stamps from public.docs group by space;

-- =====================================================================
-- Land Litigation Intelligence - Supabase schema
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================

-- 1) Government whitelist -------------------------------------------
-- Officials are NOT created by the register page. You add their email here
-- first, then create their login in Authentication -> Users (see README).
create table if not exists public.gov_officials (
  email       text primary key,
  full_name   text,
  department  text,
  created_at  timestamptz not null default now(),
  constraint gov_email_domain check (lower(email) like '%@gov.in')
);
alter table public.gov_officials enable row level security;   -- no policies = not reachable from the browser

-- 2) Administrator whitelist / accounts ------------------------------
-- Administrators are added directly to this table via SQL query or Supabase Dashboard.
create table if not exists public.admin_users (
  email       text primary key,
  full_name   text,
  created_at  timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- 3) Profiles (one per auth user, holds the role) ---------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null check (role in ('citizen','government','admin')),
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Ensure constraint supports 'admin' even if table already existed
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('citizen','government','admin'));

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

-- users may change their name only, never their role
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 4) Decide the role when an account is created -----------------------
--    * email in admin_users                  -> admin
--    * email in gov_officials (and @gov.in)  -> government
--    * email ending @gmail.com               -> citizen
--    * anything else                         -> sign-up is rejected
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(new.email);
  r text;
  fn text;
begin
  if exists (select 1 from public.admin_users a where lower(a.email) = e) then
    r := 'admin';
    select a.full_name into fn from public.admin_users a where lower(a.email) = e;
  elsif e like '%@gov.in' and exists (select 1 from public.gov_officials g where lower(g.email) = e) then
    r := 'government';
    select g.full_name into fn from public.gov_officials g where lower(g.email) = e;
  elsif e like '%@gmail.com' then
    r := 'citizen';
    fn := new.raw_user_meta_data ->> 'full_name';
  else
    raise exception 'Registration is open to @gmail.com citizens only. Government and Administrator accounts are created by the administrator.';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', fn, 'Administrator'),
          r)
  on conflict (id) do update set
    role = excluded.role,
    full_name = coalesce(excluded.full_name, profiles.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Cases a citizen is tracking --------------------------------------
create table if not exists public.tracked_cases (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  case_id               text not null,
  survey_no             text,
  subdivision           text,
  village               text,
  last_status           text,
  last_hearing_count    int,
  last_adjournment_count int,
  last_disposal_date    text,
  created_at            timestamptz not null default now(),
  unique (user_id, case_id)
);
alter table public.tracked_cases enable row level security;
drop policy if exists "tracked: own rows" on public.tracked_cases;
create policy "tracked: own rows" on public.tracked_cases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5) Notifications ------------------------------------------------------
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  case_id     text,
  kind        text not null default 'info',   -- tracking | status | hearing | adjournment | disposal | info
  title       text not null,
  message     text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications: own rows" on public.notifications;
create policy "notifications: own rows" on public.notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- live updates for the notification bell
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- =====================================================================
-- 1. ADD A GOVERNMENT OFFICIAL (repeat for each official)
-- Step A - whitelist the email (run in SQL Editor):
--
--   insert into public.gov_officials (email, full_name, department)
--   values ('collector.dharmapuri@gov.in', 'District Collector', 'Revenue')
--   on conflict (email) do update set full_name = excluded.full_name;
--
-- Step B - Supabase Dashboard -> Authentication -> Users -> Add user ->
--   "Create new user": same email + a password, tick "Auto Confirm User".
--   The trigger above gives that account the 'government' role automatically.
-- =====================================================================

-- =====================================================================
-- 2. ADD AN ADMINISTRATOR MANUALLY VIA DATABASE / SQL QUERY
--
-- METHOD A: Whitelist in SQL Editor + Create User in Supabase Auth (Standard)
-- ---------------------------------------------------------------------
-- Step 1 (Run in SQL Editor):
--   insert into public.admin_users (email, full_name)
--   values ('admin@landlitigation.gov.in', 'System Administrator')
--   on conflict (email) do update set full_name = excluded.full_name;
--
-- Step 2 (Supabase Dashboard):
--   Authentication -> Users -> "Add user" -> "Create new user"
--   Email: admin@landlitigation.gov.in
--   Password: <your_password>
--   Tick "Auto Confirm User"
--   Click "Create user".
--   The handle_new_user trigger automatically gives that account the 'admin' role in public.profiles.
--
-- METHOD B: 100% Pure SQL Query (Create Whitelist + Auth User + Profile in 1 SQL Run)
-- ---------------------------------------------------------------------
-- Run this block directly in Supabase SQL Editor (change email & password as needed):
--
-- do $$
-- declare
--   admin_email text := 'admin@landlitigation.gov.in';
--   admin_pass  text := 'admin123';  -- replace with your password
--   admin_name  text := 'System Administrator';
--   uid uuid;
-- begin
--   -- A. Whitelist
--   insert into public.admin_users (email, full_name)
--   values (admin_email, admin_name)
--   on conflict (email) do update set full_name = excluded.full_name;
--
--   -- B. Insert or update in auth.users
--   select id into uid from auth.users where lower(email) = lower(admin_email);
--   if uid is null then
--     uid := gen_random_uuid();
--     insert into auth.users (
--       instance_id, id, aud, role, email, encrypted_password,
--       email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
--     ) values (
--       '00000000-0000-0000-0000-000000000000',
--       uid,
--       'authenticated',
--       'authenticated',
--       admin_email,
--       crypt(admin_pass, gen_salt('bf')),
--       now(),
--       '{"provider":"email","providers":["email"]}',
--       json_build_object('full_name', admin_name),
--       now(),
--       now()
--     );
--   else
--     update auth.users
--     set encrypted_password = crypt(admin_pass, gen_salt('bf')),
--         email_confirmed_at = coalesce(email_confirmed_at, now()),
--         updated_at = now()
--     where id = uid;
--   end if;
--
--   -- C. Ensure profiles table has role = 'admin'
--   insert into public.profiles (id, email, full_name, role)
--   values (uid, admin_email, admin_name, 'admin')
--   on conflict (id) do update set role = 'admin', full_name = excluded.full_name;
-- end $$;
--
-- METHOD C: Promote an Existing Registered User to Administrator
-- ---------------------------------------------------------------------
-- If a user already exists in auth.users and you want to make them an admin:
--
--   insert into public.admin_users (email, full_name)
--   values ('existing_user@example.com', 'Admin User')
--   on conflict (email) do update set full_name = excluded.full_name;
--
--   update public.profiles
--   set role = 'admin'
--   where lower(email) = lower('existing_user@example.com');
-- =====================================================================

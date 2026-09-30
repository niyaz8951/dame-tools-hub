-- ============================================================
-- DAME Tools Hub - database schema (Supabase / PostgreSQL)
-- Run this whole file once in the Supabase SQL Editor.
-- Safe to re-run: it does not delete users or access rights.
--
-- Design:
--   * Login is username + password only. No email, no Supabase Auth.
--   * Every table has Row Level Security ON with NO policies, so the
--     public (anon) key cannot read or write any table directly.
--   * The website talks to the database ONLY through the app_* functions
--     below. Each function checks the session token and the user's role.
--   * Passwords are stored as bcrypt hashes. Session tokens are stored
--     as SHA-256 hashes, so a database leak does not expose live sessions.
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------

create table if not exists public.app_users (
  id              uuid primary key default gen_random_uuid(),
  username        text not null,
  full_name       text not null,
  team_note       text not null default '',          -- what the person typed as their team when requesting access
  pass_hash       text not null,
  role            text not null default 'user'    check (role in ('user','admin')),
  status          text not null default 'pending' check (status in ('pending','approved','rejected','disabled')),
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  approved_by     uuid references public.app_users(id),
  approved_at     timestamptz,
  last_login_at   timestamptz
);
alter table public.app_users add column if not exists avatar text;          -- small profile picture as a data: URL (resized in the browser)
create unique index if not exists app_users_username_key on public.app_users (lower(username));

create table if not exists public.app_sessions (
  token_hash  text primary key,
  user_id     uuid not null references public.app_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists app_sessions_user_idx on public.app_sessions (user_id);

-- A category is a dashboard tile and also the unit of access (one per team).
create table if not exists public.app_categories (
  id          text primary key,                      -- short slug, e.g. 'sales'
  name        text not null,
  description text not null default '',
  sort        int  not null default 100,
  is_default  boolean not null default false         -- true = every approved user gets it
);

create table if not exists public.app_user_categories (
  user_id     uuid not null references public.app_users(id) on delete cascade,
  category_id text not null references public.app_categories(id) on delete cascade,
  primary key (user_id, category_id)
);

create table if not exists public.app_tools (
  id          text primary key,                      -- slug = folder name under /tools
  category_id text not null references public.app_categories(id),
  name        text not null,
  description text not null default '',
  path        text not null default '',              -- e.g. 'tools/compliance-maker/'
  status      text not null default 'soon' check (status in ('live','soon','hidden')),
  sort        int  not null default 100
);

alter table public.app_users           enable row level security;
alter table public.app_sessions        enable row level security;
alter table public.app_categories      enable row level security;
alter table public.app_user_categories enable row level security;
alter table public.app_tools           enable row level security;

revoke all on public.app_users, public.app_sessions, public.app_categories,
              public.app_user_categories, public.app_tools from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.app_users, public.app_sessions, public.app_categories,
                  public.app_user_categories, public.app_tools from anon, authenticated;
  end if;
end $$;

-- ---------- seed: tiles and first tools ----------

insert into public.app_categories (id, name, description, sort, is_default) values
  ('general', 'General', 'Everyday productivity tools',              10, true),
  ('sales',   'Sales',   'Costing, selection and quotation tools',   20, false),
  ('sbu',     'SBU',     'Specialised SBU tools',                    30, false)
on conflict (id) do nothing;

insert into public.app_tools (id, category_id, name, description, path, status, sort) values
  ('compliance-maker', 'general', 'Compliance Maker',
   'Turn a specification PDF into a ready-to-fill compliance matrix in Excel.',
   'tools/compliance-maker/', 'live', 10),
  ('coil-data-extractor', 'general', 'Coil Data Extractor',
   'Turn coil selection quotations in Word or PDF into one Excel table, one row per coil.',
   'tools/coil-data-extractor/', 'live', 20),
  ('container-calculator', 'general', 'Container Calculator',
   'Work out how many containers or trailers a shipment needs, with a load plan and PDF report.',
   'tools/container-calculator/', 'live', 30),
  ('centre-of-gravity', 'general', 'Centre of Gravity',
   'Build a unit from blocks, find its centre of gravity and the load on every mounting foot.',
   'tools/centre-of-gravity/', 'live', 40)
on conflict (id) do nothing;

-- ---------- internal helpers (not callable from the website) ----------

create or replace function public.app__fail(msg text) returns void
language plpgsql as $$
begin
  raise exception '%', msg using errcode = 'P0001';
end $$;

create or replace function public.app__check_password(p text) returns void
language plpgsql as $$
begin
  if p is null or length(p) < 8 then
    perform public.app__fail('Password must be at least 8 characters.');
  end if;
  if length(p) > 72 then
    perform public.app__fail('Password must be 72 characters or fewer.');
  end if;
end $$;

-- Returns the user row for a valid session token, or raises.
create or replace function public.app__session_user(p_token text)
returns public.app_users
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  select usr.* into u
    from public.app_sessions s
    join public.app_users usr on usr.id = s.user_id
   where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
     and s.expires_at > now();
  if u.id is null or u.status <> 'approved' then
    perform public.app__fail('SESSION_EXPIRED');
  end if;
  return u;
end $$;

create or replace function public.app__require_admin(p_token text)
returns public.app_users
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  if u.role <> 'admin' then
    perform public.app__fail('Admin access required.');
  end if;
  return u;
end $$;

-- Profile + ONLY the tiles and tools this user may open. Tiles without access are not sent at all.
create or replace function public.app__profile(u public.app_users)
returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name,
                               'role', u.role, 'avatar', u.avatar,
                               'created_at', u.created_at, 'last_login_at', u.last_login_at),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'description', c.description, 'allowed', true,
               'tools', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', t.id, 'name', t.name, 'description', t.description,
                            'path', t.path, 'status', t.status) order by t.sort, t.name)
                     from public.app_tools t
                    where t.category_id = c.id and t.status <> 'hidden'), '[]'::jsonb)
             ) order by c.sort, c.name)
        from public.app_categories c
       where u.role = 'admin' or c.is_default
          or exists (select 1 from public.app_user_categories uc
                      where uc.category_id = c.id and uc.user_id = u.id)
    ), '[]'::jsonb)
  );
$$;

-- ---------- public API (called by the website) ----------

-- Request access. Creates a PENDING user; an admin must approve it.
create or replace function public.app_register(
  p_username text, p_full_name text, p_password text, p_team_note text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_username text := trim(coalesce(p_username, ''));
begin
  if v_username !~ '^[A-Za-z0-9._-]{3,30}$' then
    perform public.app__fail('Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    perform public.app__fail('Please enter your full name.');
  end if;
  perform public.app__check_password(p_password);
  if exists (select 1 from public.app_users where lower(username) = lower(v_username)) then
    perform public.app__fail('That username is already taken.');
  end if;
  if (select count(*) from public.app_users where status = 'pending') >= 200 then
    perform public.app__fail('Too many requests are waiting for approval. Please contact the admin.');
  end if;
  insert into public.app_users (username, full_name, team_note, pass_hash)
  values (v_username, trim(p_full_name), left(trim(coalesce(p_team_note, '')), 80),
          crypt(p_password, gen_salt('bf', 10)));
  return jsonb_build_object('ok', true);
end $$;

-- Log in. Returns a session token plus profile.
create or replace function public.app_login(p_username text, p_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  v_token text;
begin
  select * into u from public.app_users
   where lower(username) = lower(trim(coalesce(p_username, '')));

  if u.id is null then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));   -- keep timing similar
    return jsonb_build_object('ok', false, 'error', 'Wrong username or password.');
  end if;

  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Try again in 15 minutes.');
  end if;

  if u.pass_hash <> crypt(coalesce(p_password, ''), u.pass_hash) then
    update public.app_users
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = u.id;
    return jsonb_build_object('ok', false, 'error', 'Wrong username or password.');
  end if;

  if u.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Your account is waiting for admin approval.');
  elsif u.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'This account is not active. Please contact the admin.');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  delete from public.app_sessions where expires_at < now();
  insert into public.app_sessions (token_hash, user_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), u.id, now() + interval '12 hours');
  update public.app_users
     set failed_attempts = 0, locked_until = null, last_login_at = now()
   where id = u.id;

  return jsonb_build_object('ok', true, 'token', v_token) || public.app__profile(u);
end $$;

-- Who am I + what may I open. Called on every page load.
create or replace function public.app_me(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public.app__profile(public.app__session_user(p_token));
end $$;

create or replace function public.app_logout(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.app_sessions
   where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_change_password(p_token text, p_old text, p_new text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  if u.pass_hash <> crypt(coalesce(p_old, ''), u.pass_hash) then
    perform public.app__fail('Current password is wrong.');
  end if;
  perform public.app__check_password(p_new);
  update public.app_users set pass_hash = crypt(p_new, gen_salt('bf', 10)) where id = u.id;
  -- sign out every other session of this user
  delete from public.app_sessions
   where user_id = u.id
     and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- Change own display name and profile picture. p_avatar: a small data: URL, or '' to remove it.
create or replace function public.app_update_profile(p_token text, p_full_name text, p_avatar text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  if length(trim(coalesce(p_full_name, ''))) < 2 or length(trim(p_full_name)) > 60 then
    perform public.app__fail('Please enter your name (2 to 60 characters).');
  end if;
  if coalesce(p_avatar, '') <> '' then
    if length(p_avatar) > 60000 then
      perform public.app__fail('That picture is too large.');
    end if;
    if p_avatar !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
      perform public.app__fail('That picture format is not supported.');
    end if;
  end if;
  update public.app_users
     set full_name = trim(p_full_name), avatar = nullif(p_avatar, '')
   where id = u.id
   returning * into u;
  return jsonb_build_object('ok', true) || public.app__profile(u);
end $$;

-- ---------- admin API ----------

create or replace function public.app_admin_overview(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_admin(p_token);
  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'username', u.username, 'full_name', u.full_name,
               'team_note', u.team_note, 'role', u.role, 'status', u.status,
               'created_at', u.created_at, 'last_login_at', u.last_login_at,
               'categories', coalesce((select jsonb_agg(uc.category_id order by uc.category_id)
                                         from public.app_user_categories uc
                                        where uc.user_id = u.id), '[]'::jsonb)
             ) order by (u.status = 'pending') desc, u.created_at desc)
        from public.app_users u), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'is_default', c.is_default)
                       order by c.sort, c.name)
        from public.app_categories c), '[]'::jsonb),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category_id', t.category_id,
                                          'description', t.description, 'path', t.path,
                                          'status', t.status, 'sort', t.sort)
                       order by t.category_id, t.sort, t.name)
        from public.app_tools t), '[]'::jsonb)
  );
end $$;

-- Approve / reject / disable a user, set role, and set which tiles they may open.
create or replace function public.app_admin_set_user(
  p_token text, p_user_id uuid, p_status text, p_role text, p_categories text[])
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users;
  t public.app_users;
begin
  a := public.app__require_admin(p_token);
  select * into t from public.app_users where id = p_user_id;
  if t.id is null then perform public.app__fail('User not found.'); end if;
  if p_status not in ('pending','approved','rejected','disabled') then
    perform public.app__fail('Invalid status.');
  end if;
  if p_role not in ('user','admin') then perform public.app__fail('Invalid role.'); end if;

  -- never leave the site without an active admin
  if t.role = 'admin' and t.status = 'approved'
     and (p_role <> 'admin' or p_status <> 'approved')
     and (select count(*) from public.app_users
           where role = 'admin' and status = 'approved' and id <> t.id) = 0 then
    perform public.app__fail('You cannot remove the last active admin.');
  end if;

  update public.app_users
     set status = p_status,
         role   = p_role,
         approved_by = case when p_status = 'approved' and t.status <> 'approved' then a.id else approved_by end,
         approved_at = case when p_status = 'approved' and t.status <> 'approved' then now() else approved_at end,
         failed_attempts = 0,
         locked_until = null
   where id = t.id;

  delete from public.app_user_categories where user_id = t.id;
  insert into public.app_user_categories (user_id, category_id)
  select t.id, c.id from public.app_categories c
   where c.id = any(coalesce(p_categories, '{}'::text[])) and not c.is_default;

  if p_status <> 'approved' then
    delete from public.app_sessions where user_id = t.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_admin_reset_password(
  p_token text, p_user_id uuid, p_new_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_admin(p_token);
  perform public.app__check_password(p_new_password);
  update public.app_users
     set pass_hash = crypt(p_new_password, gen_salt('bf', 10)),
         failed_attempts = 0, locked_until = null
   where id = p_user_id;
  if not found then perform public.app__fail('User not found.'); end if;
  delete from public.app_sessions where user_id = p_user_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_admin_delete_user(p_token text, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.app_users; t public.app_users;
begin
  a := public.app__require_admin(p_token);
  select * into t from public.app_users where id = p_user_id;
  if t.id is null then perform public.app__fail('User not found.'); end if;
  if t.id = a.id then perform public.app__fail('You cannot delete your own account.'); end if;
  if t.status = 'approved' then
    perform public.app__fail('Disable the user first, then delete.');
  end if;
  update public.app_users set approved_by = null where approved_by = t.id;
  delete from public.app_users where id = t.id;
  return jsonb_build_object('ok', true);
end $$;

-- Add or edit a tool (the tile contents). New category tiles are added the same way.
create or replace function public.app_admin_save_tool(
  p_token text, p_id text, p_category_id text, p_name text,
  p_description text, p_path text, p_status text, p_sort int default 100)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_admin(p_token);
  if coalesce(p_id, '') !~ '^[a-z0-9-]{2,40}$' then
    perform public.app__fail('Tool id must be lowercase letters, numbers and dashes.');
  end if;
  if not exists (select 1 from public.app_categories where id = p_category_id) then
    perform public.app__fail('Unknown category.');
  end if;
  if p_status not in ('live','soon','hidden') then perform public.app__fail('Invalid status.'); end if;
  if length(trim(coalesce(p_name, ''))) < 2 then perform public.app__fail('Tool name is required.'); end if;
  if coalesce(p_path, '') <> '' and p_path !~ '^tools/[a-z0-9-]+/$' then
    perform public.app__fail('Path must look like tools/my-tool/');
  end if;
  insert into public.app_tools (id, category_id, name, description, path, status, sort)
  values (p_id, p_category_id, trim(p_name), trim(coalesce(p_description, '')),
          coalesce(p_path, ''), p_status, coalesce(p_sort, 100))
  on conflict (id) do update
     set category_id = excluded.category_id, name = excluded.name,
         description = excluded.description, path = excluded.path,
         status = excluded.status, sort = excluded.sort;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_admin_save_category(
  p_token text, p_id text, p_name text, p_description text,
  p_sort int default 100, p_is_default boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_admin(p_token);
  if coalesce(p_id, '') !~ '^[a-z0-9-]{2,30}$' then
    perform public.app__fail('Category id must be lowercase letters, numbers and dashes.');
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then perform public.app__fail('Category name is required.'); end if;
  insert into public.app_categories (id, name, description, sort, is_default)
  values (p_id, trim(p_name), trim(coalesce(p_description, '')), coalesce(p_sort, 100), coalesce(p_is_default, false))
  on conflict (id) do update
     set name = excluded.name, description = excluded.description,
         sort = excluded.sort, is_default = excluded.is_default;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- first admin (SQL Editor only, never from the website) ----------
-- After running this file, create your own admin ONCE with:
--     select public.app_bootstrap_admin('your.username', 'Your Full Name', 'a-strong-password');
create or replace function public.app_bootstrap_admin(p_username text, p_full_name text, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from public.app_users where role = 'admin') then
    return 'An admin already exists. Use the Admin page on the website instead.';
  end if;
  perform public.app__check_password(p_password);
  insert into public.app_users (username, full_name, pass_hash, role, status, approved_at)
  values (trim(p_username), trim(p_full_name), crypt(p_password, gen_salt('bf', 10)), 'admin', 'approved', now());
  return 'Admin created. You can now log in on the website.';
end $$;

-- ---------- permissions: website may call ONLY the public/admin API ----------
do $$
declare
  f record;
  has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'app\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if has_anon then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
      if f.proname not like 'app\_\_%' and f.proname <> 'app_bootstrap_admin' then
        execute format('grant execute on function %s to anon, authenticated', f.sig);
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

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
   'tools/centre-of-gravity/', 'live', 40),
  ('datasheet-notes', 'general', 'Datasheet Notes',
   'Turn a product datasheet PDF into an Excel table of unit data, sections and options.',
   'tools/datasheet-notes/', 'live', 15)
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


-- ============================================================
-- COMPLIANCE MAKER - master library
--
--   cm_products / cm_factories   what can be selected before converting
--   cm_runs                      one row per conversion (any user) or library upload
--   cm_run_lines                 every line of every run, in order, as converted
--   cm_lines                     the MASTER LIBRARY: one row per unique clause per factory,
--                                with the Compliance / Remarks an admin filled in
--   cm_answer_log                every answer ever given to a line (who, when, from where)
--
-- A clause is "the same line" when its normalised text matches (lower case,
-- punctuation and spacing ignored) for the same factory. The same clause can
-- have a different correct answer at another factory, so answers never cross
-- factories. Normalising is done here in the database (cm__norm) so every
-- caller, now and later, compares text the same way.
-- ============================================================

create table if not exists public.cm_products (
  id     text primary key,                 -- slug, e.g. 'ahu'
  name   text not null,
  sort   int  not null default 100,
  active boolean not null default true
);

create table if not exists public.cm_factories (
  id         text primary key,             -- slug, e.g. 'ahu-dubai'
  product_id text not null references public.cm_products(id),
  name       text not null,
  sort       int  not null default 100,
  active     boolean not null default true,
  unique (product_id, name)
);

create table if not exists public.cm_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'conversion' check (kind in ('conversion','library-upload')),
  user_id       uuid references public.app_users(id) on delete set null,
  product_id    text not null references public.cm_products(id),
  factory_id    text not null references public.cm_factories(id),
  source        text not null default '',  -- pdf | text | xlsx
  file_name     text not null default '',
  line_count    int  not null default 0,   -- rows in the run
  unique_count  int  not null default 0,   -- distinct library lines touched
  matched_count int  not null default 0,   -- rows filled from the library
  created_at    timestamptz not null default now()
);
create index if not exists cm_runs_created_idx on public.cm_runs (created_at desc);

create table if not exists public.cm_lines (
  id            uuid primary key default gen_random_uuid(),
  product_id    text not null references public.cm_products(id),
  factory_id    text not null references public.cm_factories(id),
  norm_hash     text not null,             -- md5 of norm_text: the match key
  norm_text     text not null,
  spec_text     text not null,             -- the clause as first seen
  compliance    text not null default '',
  remarks       text not null default '',
  status        text not null default 'open' check (status in ('open','answered')),
  times_seen    int  not null default 0,   -- number of conversions this line appeared in
  first_run_id  uuid references public.cm_runs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  answered_by   uuid references public.app_users(id) on delete set null,
  answered_at   timestamptz,
  answer_source text not null default '',  -- admin | upload   (later: ai)
  unique (factory_id, norm_hash)
);
create index if not exists cm_lines_list_idx on public.cm_lines (factory_id, status, times_seen desc);

create table if not exists public.cm_run_lines (
  run_id    uuid not null references public.cm_runs(id) on delete cascade,
  seq       int  not null,                 -- position in the document, from 0
  type      text not null default '',      -- part | section | letter | number | text
  sr        text not null default '',
  spec_text text not null default '',
  line_id   uuid references public.cm_lines(id) on delete set null,   -- null for headings
  primary key (run_id, seq)
);
create index if not exists cm_run_lines_line_idx on public.cm_run_lines (line_id);

create table if not exists public.cm_answer_log (
  id         bigint generated always as identity primary key,
  line_id    uuid not null references public.cm_lines(id) on delete cascade,
  compliance text not null default '',
  remarks    text not null default '',
  source     text not null default '',     -- admin | upload
  run_id     uuid references public.cm_runs(id) on delete set null,
  user_id    uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cm_answer_log_line_idx on public.cm_answer_log (line_id, created_at desc);

alter table public.cm_products   enable row level security;
alter table public.cm_factories  enable row level security;
alter table public.cm_runs       enable row level security;
alter table public.cm_lines      enable row level security;
alter table public.cm_run_lines  enable row level security;
alter table public.cm_answer_log enable row level security;
revoke all on public.cm_products, public.cm_factories, public.cm_runs, public.cm_lines,
              public.cm_run_lines, public.cm_answer_log from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.cm_products, public.cm_factories, public.cm_runs, public.cm_lines,
                  public.cm_run_lines, public.cm_answer_log from anon, authenticated;
  end if;
end $$;

insert into public.cm_products (id, name, sort) values
  ('ahu', 'AHU', 10), ('fcu', 'FCU', 20), ('chiller', 'Chiller', 30)
on conflict (id) do nothing;

insert into public.cm_factories (id, product_id, name, sort) values
  ('ahu-dubai',      'ahu',     'Dubai',    10),
  ('ahu-riyadh',     'ahu',     'Riyadh',   20),
  ('fcu-shenzhen',   'fcu',     'Shenzhen', 10),
  ('fcu-riyadh',     'fcu',     'Riyadh',   20),
  ('chiller-italy',  'chiller', 'Italy',    10),
  ('chiller-jeddah', 'chiller', 'Jeddah',   20)
on conflict (id) do nothing;

-- ---------- internal helpers ----------

-- The one place text is normalised for matching.
create or replace function public.cm__norm(t text) returns text
language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.cm__factory(p_factory_id text)
returns public.cm_factories
language plpgsql security definer set search_path = public, extensions as $$
declare f public.cm_factories;
begin
  select fa.* into f from public.cm_factories fa
    join public.cm_products p on p.id = fa.product_id
   where fa.id = p_factory_id and fa.active and p.active;
  if f.id is null then perform public.app__fail('Choose a product and factory first.'); end if;
  return f;
end $$;

-- ---------- user API ----------

-- Products and their factories, for the two dropdowns.
create or replace function public.cm_options(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__session_user(p_token);
  return jsonb_build_object('products', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
             'factories', coalesce((
               select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.sort, f.name)
                 from public.cm_factories f where f.product_id = p.id and f.active), '[]'::jsonb))
           order by p.sort, p.name)
      from public.cm_products p where p.active), '[]'::jsonb));
end $$;

-- Save one conversion and get back the answers the library already holds.
--   p_lines: [{ "type": "letter", "sr": "A.", "spec": "Casing shall be ..." }, ...] in document order
-- Every line is stored. Body lines (letter / number / text) are added to the master
-- library once each; headings are kept with the run only.
create or replace function public.cm_save_run(
  p_token text, p_factory_id text, p_source text, p_file_name text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  f public.cm_factories;
  v_run uuid;
  v_lines int; v_unique int; v_matched int;
  v_answers jsonb;
begin
  u := public.app__session_user(p_token);
  f := public.cm__factory(p_factory_id);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform public.app__fail('There are no lines to save.');
  end if;
  if jsonb_array_length(p_lines) > 8000 then
    perform public.app__fail('This specification is too long to save in one go (more than 8000 lines).');
  end if;

  insert into public.cm_runs (kind, user_id, product_id, factory_id, source, file_name)
  values ('conversion', u.id, f.product_id, f.id,
          case when p_source in ('pdf','text') then p_source else '' end,
          left(coalesce(p_file_name, ''), 200))
  returning id into v_run;

  with src as (
    select (e.ord - 1)::int as seq,
           left(coalesce(e.val->>'type', ''), 12) as type,
           left(coalesce(e.val->>'sr', ''), 40)   as sr,
           left(coalesce(e.val->>'spec', ''), 6000) as spec
      from jsonb_array_elements(p_lines) with ordinality as e(val, ord)
  ), body as (
    select seq, spec, public.cm__norm(spec) as norm
      from src where type in ('letter','number','text')
  ), uniq as (
    select distinct on (norm) norm, spec from body where length(norm) >= 8 order by norm, seq
  ), up as (
    insert into public.cm_lines (product_id, factory_id, norm_hash, norm_text, spec_text, first_run_id, times_seen)
    select f.product_id, f.id, md5(q.norm), q.norm, q.spec, v_run, 1 from uniq q
    on conflict (factory_id, norm_hash) do update
       set times_seen = public.cm_lines.times_seen + 1, last_seen_at = now()
    returning id, norm_hash
  )
  insert into public.cm_run_lines (run_id, seq, type, sr, spec_text, line_id)
  select v_run, s.seq, s.type, s.sr, s.spec, up.id
    from src s
    left join body b on b.seq = s.seq
    left join up on up.norm_hash = md5(b.norm);

  select count(*), count(distinct rl.line_id),
         count(*) filter (where l.status = 'answered'),
         coalesce(jsonb_agg(jsonb_build_object('i', rl.seq, 'compliance', l.compliance, 'remarks', l.remarks)
                            order by rl.seq) filter (where l.status = 'answered'), '[]'::jsonb)
    into v_lines, v_unique, v_matched, v_answers
    from public.cm_run_lines rl
    left join public.cm_lines l on l.id = rl.line_id
   where rl.run_id = v_run;

  update public.cm_runs set line_count = v_lines, unique_count = v_unique, matched_count = v_matched
   where id = v_run;

  return jsonb_build_object('ok', true, 'run_id', v_run, 'lines', v_lines,
                            'unique_lines', v_unique, 'matched', v_matched, 'answers', v_answers);
end $$;

-- ---------- admin API ----------

-- One page of the library for a factory, unanswered and most-seen first.
create or replace function public.cm_admin_lines(
  p_token text, p_factory_id text, p_status text default 'open',
  p_search text default '', p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f public.cm_factories;
  v_like text := '%' || replace(replace(replace(trim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform public.app__require_admin(p_token);
  f := public.cm__factory(p_factory_id);
  return jsonb_build_object(
    'counts', (select jsonb_build_object('all', count(*),
                        'open', count(*) filter (where status = 'open'),
                        'answered', count(*) filter (where status = 'answered'))
                 from public.cm_lines where factory_id = f.id),
    'total', (select count(*) from public.cm_lines l
               where l.factory_id = f.id
                 and (p_status = 'all' or l.status = p_status)
                 and l.spec_text ilike v_like),
    'lines', coalesce((
      select jsonb_agg(x.j order by x.rn) from (
        select row_number() over (order by (l.status = 'open') desc, l.times_seen desc, l.last_seen_at desc, l.id) as rn,
               jsonb_build_object('id', l.id, 'spec_text', l.spec_text, 'compliance', l.compliance,
                 'remarks', l.remarks, 'status', l.status, 'times_seen', l.times_seen,
                 'last_seen_at', l.last_seen_at, 'answered_at', l.answered_at,
                 'answer_source', l.answer_source,
                 'answered_by', (select au.full_name from public.app_users au where au.id = l.answered_by)) as j
          from public.cm_lines l
         where l.factory_id = f.id
           and (p_status = 'all' or l.status = p_status)
           and l.spec_text ilike v_like
         order by (l.status = 'open') desc, l.times_seen desc, l.last_seen_at desc, l.id
         limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb));
end $$;

-- Fill in (or clear) the answer for one library line.
create or replace function public.cm_admin_save_answer(
  p_token text, p_line_id uuid, p_compliance text, p_remarks text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users;
  v_c text := left(trim(coalesce(p_compliance, '')), 200);
  v_r text := left(trim(coalesce(p_remarks, '')), 4000);
  l public.cm_lines;
begin
  a := public.app__require_admin(p_token);
  update public.cm_lines
     set compliance = v_c, remarks = v_r,
         status = case when v_c <> '' or v_r <> '' then 'answered' else 'open' end,
         answered_by = a.id, answered_at = now(), answer_source = 'admin'
   where id = p_line_id
   returning * into l;
  if l.id is null then perform public.app__fail('That line no longer exists.'); end if;
  insert into public.cm_answer_log (line_id, compliance, remarks, source, user_id)
  values (l.id, v_c, v_r, 'admin', a.id);
  return jsonb_build_object('ok', true, 'status', l.status);
end $$;

create or replace function public.cm_admin_delete_line(p_token text, p_line_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_admin(p_token);
  delete from public.cm_lines where id = p_line_id;
  if not found then perform public.app__fail('That line no longer exists.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Load a filled compliance sheet into the library.
--   p_rows: [{ "spec": "...", "compliance": "Comply", "remarks": "..." }, ...]
-- Only rows that carry an answer are taken. Each distinct clause becomes (or updates)
-- one library line; when the same clause appears twice in the file the last one wins.
create or replace function public.cm_admin_import(
  p_token text, p_factory_id text, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users;
  f public.cm_factories;
  v_run uuid;
  v_total int; v_unique int; v_added int; v_updated int;
begin
  a := public.app__require_admin(p_token);
  f := public.cm__factory(p_factory_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.app__fail('No rows were found in that file.');
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 20000 then perform public.app__fail('That file has more than 20000 rows. Split it and upload in parts.'); end if;

  insert into public.cm_runs (kind, user_id, product_id, factory_id, source, file_name, line_count)
  values ('library-upload', a.id, f.product_id, f.id, 'xlsx', left(coalesce(p_file_name, ''), 200), v_total)
  returning id into v_run;

  with src as (
    select e.ord,
           left(coalesce(e.val->>'spec', ''), 6000) as spec,
           left(trim(coalesce(e.val->>'compliance', '')), 200) as c,
           left(trim(coalesce(e.val->>'remarks', '')), 4000)   as r
      from jsonb_array_elements(p_rows) with ordinality as e(val, ord)
  ), uniq as (
    select distinct on (public.cm__norm(spec)) public.cm__norm(spec) as norm, trim(spec) as spec, c, r
      from src
     where (c <> '' or r <> '') and length(public.cm__norm(spec)) >= 8
     order by public.cm__norm(spec), ord desc
  ), old as (
    select l.norm_hash from public.cm_lines l
     where l.factory_id = f.id and l.norm_hash in (select md5(norm) from uniq)
  ), up as (
    insert into public.cm_lines (product_id, factory_id, norm_hash, norm_text, spec_text, compliance, remarks,
                                 status, first_run_id, answered_by, answered_at, answer_source, times_seen)
    select f.product_id, f.id, md5(q.norm), q.norm, q.spec, q.c, q.r, 'answered', v_run, a.id, now(), 'upload', 0
      from uniq q
    on conflict (factory_id, norm_hash) do update
       set compliance = excluded.compliance, remarks = excluded.remarks, status = 'answered',
           answered_by = excluded.answered_by, answered_at = now(), answer_source = 'upload'
     where public.cm_lines.compliance is distinct from excluded.compliance
        or public.cm_lines.remarks    is distinct from excluded.remarks
    returning id, norm_hash, compliance, remarks
  ), logged as (
    insert into public.cm_answer_log (line_id, compliance, remarks, source, run_id, user_id)
    select id, compliance, remarks, 'upload', v_run, a.id from up
    returning 1
  )
  select (select count(*) from uniq),
         (select count(*) from up where norm_hash not in (select norm_hash from old)),
         (select count(*) from up where norm_hash in (select norm_hash from old)),
         (select count(*) from logged)
    into v_unique, v_added, v_updated, v_total;   -- last value only forces the log insert to run

  v_total := jsonb_array_length(p_rows);
  update public.cm_runs set unique_count = v_unique, matched_count = v_added + v_updated where id = v_run;
  return jsonb_build_object('ok', true, 'rows', v_total, 'unique_lines', v_unique,
                            'added', v_added, 'updated', v_updated,
                            'unchanged', v_unique - v_added - v_updated,
                            'skipped', v_total - v_unique);
end $$;

-- Recent conversions and uploads, newest first.
create or replace function public.cm_admin_runs(p_token text, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_admin(p_token);
  return jsonb_build_object(
    'total', (select count(*) from public.cm_runs),
    'runs', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select r.created_at, jsonb_build_object('id', r.id, 'kind', r.kind, 'created_at', r.created_at,
                 'user', coalesce(au.full_name, '(deleted user)'), 'username', coalesce(au.username, ''),
                 'product', p.name, 'factory', fa.name, 'source', r.source, 'file_name', r.file_name,
                 'line_count', r.line_count, 'unique_count', r.unique_count, 'matched_count', r.matched_count) as j
          from public.cm_runs r
          join public.cm_products p on p.id = r.product_id
          join public.cm_factories fa on fa.id = r.factory_id
          left join public.app_users au on au.id = r.user_id
         order by r.created_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb));
end $$;

-- Everything answered for a factory, for the "Download library" button.
create or replace function public.cm_admin_export(p_token text, p_factory_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.cm_factories;
begin
  perform public.app__require_admin(p_token);
  f := public.cm__factory(p_factory_id);
  return jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object('spec_text', l.spec_text, 'compliance', l.compliance,
                                        'remarks', l.remarks, 'times_seen', l.times_seen)
                     order by (l.status = 'open') desc, l.times_seen desc, l.spec_text)
      from public.cm_lines l where l.factory_id = f.id), '[]'::jsonb));
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

-- ============================================================
-- DATASHEET NOTES - row mapping
--
-- The Datasheet Notes tool reads a product datasheet in the browser and
-- builds a Section / Component / Specs / Remarks table. Admins decide, per
-- factory, which rows go into that table and what each row says:
--   dn_rules      one row per datasheet row (key = section | sub-heading | component)
--                   show      false = the row is left out
--                   label     name to print in the Component column ('' = as on the datasheet)
--                   response  '' = datasheet value; text = standard response;
--                             $ or * in the text = where the datasheet value goes
--                   reviewed  false = added automatically from a user's datasheet and not
--                             yet looked at by an admin (shown as "New" on the mapping screen)
--   dn_settings   per factory: are rows with no rule shown or hidden
-- Every run of the tool by any user adds the row names it has not seen before
-- (dn_add_rows), so the mapping list keeps growing on its own. Only names are
-- stored. The datasheet and its values are never stored.
-- ============================================================

create table if not exists public.dn_rules (
  factory_id text not null references public.cm_factories(id) on delete cascade,
  row_key    text not null,
  section    text not null default '',
  sub        text not null default '',
  component  text not null default '',
  show       boolean not null default true,
  label      text not null default '',
  response   text not null default '',
  sort       int  not null default 0,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (factory_id, row_key)
);

create table if not exists public.dn_settings (
  factory_id    text primary key references public.cm_factories(id) on delete cascade,
  show_unmapped boolean not null default true,
  updated_by    uuid references public.app_users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table public.dn_rules add column if not exists reviewed boolean not null default true;

alter table public.dn_rules    enable row level security;
alter table public.dn_settings enable row level security;
revoke all on public.dn_rules, public.dn_settings from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.dn_rules, public.dn_settings from anon, authenticated;
  end if;
end $$;

-- The mapping for one factory. Any approved user: the tool needs it to build the table.
create or replace function public.dn_get_rules(p_token text, p_factory_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.cm_factories;
begin
  perform public.app__session_user(p_token);
  f := public.cm__factory(p_factory_id);
  return jsonb_build_object(
    'show_unmapped', coalesce((select s.show_unmapped from public.dn_settings s where s.factory_id = f.id), true),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.row_key, 'section', r.section, 'sub', r.sub,
               'component', r.component, 'show', r.show, 'label', r.label, 'response', r.response,
               'new', not r.reviewed)
             order by r.sort, r.row_key)
        from public.dn_rules r where r.factory_id = f.id), '[]'::jsonb));
end $$;

-- Called by the tool after every datasheet it reads, for any approved user.
-- Adds the rows this factory's mapping has not seen before; rows already there are not touched.
--   p_rows: [{ "key", "section", "sub", "component" }, ...] in datasheet order
-- A new row starts as shown or left out according to the factory's "rows not in the list yet"
-- setting, with the datasheet value, and is marked for the admins to review.
create or replace function public.dn_add_rows(p_token text, p_factory_id text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f public.cm_factories;
  v_show boolean; v_base int; v_added int := 0;
begin
  perform public.app__session_user(p_token);
  f := public.cm__factory(p_factory_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    perform public.app__fail('The rows could not be read.');
  end if;
  if jsonb_array_length(p_rows) > 3000 then
    perform public.app__fail('Too many rows to add in one go (more than 3000).');
  end if;
  v_show := coalesce((select s.show_unmapped from public.dn_settings s where s.factory_id = f.id), true);
  v_base := coalesce((select max(r.sort) from public.dn_rules r where r.factory_id = f.id), 0);

  insert into public.dn_rules (factory_id, row_key, section, sub, component, show, sort, reviewed)
  select f.id, x.key, x.section, x.sub, x.component, v_show, v_base + x.ord, false
    from (
      select distinct on (trim(e->>'key'))
             trim(e->>'key') as key,
             left(trim(coalesce(e->>'section', '')), 200)   as section,
             left(trim(coalesce(e->>'sub', '')), 200)       as sub,
             left(trim(coalesce(e->>'component', '')), 200) as component,
             ord::int as ord
        from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
       where length(trim(coalesce(e->>'key', ''))) between 1 and 300
       order by trim(e->>'key'), ord
    ) x
  on conflict (factory_id, row_key) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('ok', true, 'added', v_added);
end $$;

-- Save the mapping for one factory.
--   p_rules:  [{ "key", "section", "sub", "component", "show", "label", "response" }, ...] in display order.
--             Rows already stored and not in the list are kept as they are.
--   p_remove: ["key", ...] rules to delete.
create or replace function public.dn_admin_save_rules(
  p_token text, p_factory_id text, p_show_unmapped boolean, p_rules jsonb, p_remove jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  f public.cm_factories;
  v_saved int := 0; v_removed int := 0;
begin
  u := public.app__require_admin(p_token);
  f := public.cm__factory(p_factory_id);
  p_rules  := coalesce(p_rules,  '[]'::jsonb);
  p_remove := coalesce(p_remove, '[]'::jsonb);
  if jsonb_typeof(p_rules) <> 'array' or jsonb_typeof(p_remove) <> 'array' then
    perform public.app__fail('The mapping could not be read.');
  end if;
  if jsonb_array_length(p_rules) > 3000 then
    perform public.app__fail('Too many rows to save in one go (more than 3000).');
  end if;
  if exists (select 1 from jsonb_array_elements(p_rules) e
              where length(trim(coalesce(e->>'key', ''))) not between 1 and 300) then
    perform public.app__fail('A row has no name and cannot be saved.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_rules) e
              where length(coalesce(e->>'label', '')) > 120 or length(coalesce(e->>'response', '')) > 1000) then
    perform public.app__fail('A name is longer than 120 characters or a response is longer than 1000 characters.');
  end if;

  delete from public.dn_rules r
   where r.factory_id = f.id
     and r.row_key in (select jsonb_array_elements_text(p_remove));
  get diagnostics v_removed = row_count;

  insert into public.dn_rules (factory_id, row_key, section, sub, component, show, label, response, sort, updated_by, updated_at, reviewed)
  select f.id, x.key, x.section, x.sub, x.component, x.show, x.label, x.response, x.sort, u.id, now(), true
    from (
      select distinct on (trim(e->>'key'))
             trim(e->>'key') as key,
             left(trim(coalesce(e->>'section', '')), 200)   as section,
             left(trim(coalesce(e->>'sub', '')), 200)       as sub,
             left(trim(coalesce(e->>'component', '')), 200) as component,
             coalesce((e->>'show')::boolean, true)          as show,
             trim(coalesce(e->>'label', ''))                as label,
             trim(coalesce(e->>'response', ''))             as response,
             ord::int                                       as sort
        from jsonb_array_elements(p_rules) with ordinality as t(e, ord)
       order by trim(e->>'key'), ord
    ) x
  on conflict (factory_id, row_key) do update
     set section = excluded.section, sub = excluded.sub, component = excluded.component, sort = excluded.sort,
         updated_by = case when (dn_rules.show, dn_rules.label, dn_rules.response)
                                is distinct from (excluded.show, excluded.label, excluded.response)
                           then excluded.updated_by else dn_rules.updated_by end,
         updated_at = case when (dn_rules.show, dn_rules.label, dn_rules.response)
                                is distinct from (excluded.show, excluded.label, excluded.response)
                           then excluded.updated_at else dn_rules.updated_at end,
         show = excluded.show, label = excluded.label, response = excluded.response, reviewed = true;
  get diagnostics v_saved = row_count;

  insert into public.dn_settings (factory_id, show_unmapped, updated_by, updated_at)
  values (f.id, coalesce(p_show_unmapped, true), u.id, now())
  on conflict (factory_id) do update
     set show_unmapped = excluded.show_unmapped, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'saved', v_saved, 'removed', v_removed);
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
     where n.nspname = 'public' and (p.proname like 'app\_%' or p.proname like 'cm\_%' or p.proname like 'dn\_%')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if has_anon then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
      if f.proname not like '%\_\_%' and f.proname <> 'app_bootstrap_admin' then
        execute format('grant execute on function %s to anon, authenticated', f.sig);
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

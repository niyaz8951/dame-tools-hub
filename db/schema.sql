-- ============================================================
-- DAME Tools Hub - database schema (Supabase / PostgreSQL)
-- This is the ONLY file to run. Paste the whole of it in the Supabase
-- SQL Editor and press Run: at first set-up and after every site update.
-- Safe to re-run: it does not delete users, access rights or saved data.
--
-- Order of the parts (a later part uses the tables of the earlier ones):
--   1. Users, sessions, tiles, tools        app_*
--   2. Compliance Maker library             cm_*
--   3. Datasheet Notes row mapping          dn_*
--   4. Product Options                      po_*
--   5. Projects, review, history            pr_*
--   6. Permissions (always last)
-- Who may do what is listed in db/README.md.
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
  role            text not null default 'user',   -- user | admin | superuser (see "roles" below)
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
-- Roles:
--   superuser  the site owner. Exactly one. Manages roles, deletes users, sets up tools and tiles.
--   admin      approves users, sets their tile access and per-tool edit rights; may edit every tool's data.
--   user       runs the tools. Can be given edit rights for single tools (app_tool_editors).
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('user','admin','superuser'));

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
-- editable = the tool has an edit screen (a library, a row mapping) that admins and chosen users maintain.
alter table public.app_tools add column if not exists editable boolean not null default false;
-- Tools that are opened from inside a project (Compliance Maker, Datasheet Notes). The dashboard
-- shows them under the Projects tile, not as tiles of their own.
alter table public.app_tools add column if not exists project_tool boolean not null default false;

-- Per-tool write access for ordinary users. Admins and the superuser may edit every editable tool.
create table if not exists public.app_tool_editors (
  user_id    uuid not null references public.app_users(id) on delete cascade,
  tool_id    text not null references public.app_tools(id) on delete cascade,
  granted_by uuid references public.app_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, tool_id)
);

alter table public.app_users           enable row level security;
alter table public.app_sessions        enable row level security;
-- Admin of one tile (owner's rule, 6 Oct 2026). The super user makes a person admin of single
-- tiles. A tile admin opens that tile, may edit the data of every tool on it, and manages the
-- ordinary users' access to it. app_users.role stays 'admin' for anyone who has at least one row
-- here and 'user' for the rest; it is kept in step by app_admin_set_user.
create table if not exists public.app_category_admins (
  user_id     uuid not null references public.app_users(id) on delete cascade,
  category_id text not null references public.app_categories(id) on delete cascade,
  granted_by  uuid references public.app_users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, category_id)
);
alter table public.app_category_admins enable row level security;
revoke all on public.app_category_admins from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.app_category_admins from anon, authenticated;
  end if;
end $$;

alter table public.app_categories      enable row level security;
alter table public.app_user_categories enable row level security;
alter table public.app_tools           enable row level security;
alter table public.app_tool_editors    enable row level security;

revoke all on public.app_users, public.app_sessions, public.app_categories,
              public.app_user_categories, public.app_tools, public.app_tool_editors from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.app_users, public.app_sessions, public.app_categories,
                  public.app_user_categories, public.app_tools, public.app_tool_editors from anon, authenticated;
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
   'tools/datasheet-notes/', 'live', 15),
  ('psychrometric-chart', 'general', 'Psychrometric Chart',
   'Plot air states on an ASHRAE-style chart and read coil loads, SHR and mixing.',
   'tools/psychrometric-chart/', 'live', 50),
  ('standards', 'general', 'Standards',
   'Short summaries of the standards named in AHU, FCU and chiller specifications.',
   'tools/standards/', 'live', 60)
on conflict (id) do nothing;
update public.app_tools set editable = true where id in ('compliance-maker', 'datasheet-notes');

-- An existing site had one 'admin' created by app_bootstrap_admin: that account becomes the superuser.
-- (To move it later, run in the SQL Editor:  select public.app_set_superuser('username');)
update public.app_users set role = 'superuser'
 where not exists (select 1 from public.app_users where role = 'superuser')
   and id = (select id from public.app_users where role = 'admin' and status = 'approved'
              order by created_at limit 1);

-- One-time carry-over: an admin from before tile admins existed was admin of everything, so he
-- becomes admin of every tile. The super user then unticks what he should not have.
insert into public.app_category_admins (user_id, category_id)
select u.id, c.id from public.app_users u cross join public.app_categories c
 where u.role = 'admin' and not exists (select 1 from public.app_category_admins a where a.user_id = u.id)
on conflict do nothing;

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
  if p !~ '\S' then
    perform public.app__fail('Password cannot be only spaces.');
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

-- Is this user admin of the tile? The super user is admin of every tile.
create or replace function public.app__is_tile_admin(u public.app_users, p_category_id text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select u.role = 'superuser'
      or exists (select 1 from public.app_category_admins a where a.user_id = u.id and a.category_id = p_category_id);
$$;

-- The super user, or the admin of at least one tile.
create or replace function public.app__require_admin(p_token text)
returns public.app_users
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  if u.role not in ('admin','superuser') then
    perform public.app__fail('Admin access required.');
  end if;
  return u;
end $$;

-- Superuser only.
create or replace function public.app__require_super(p_token text)
returns public.app_users
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  if u.role <> 'superuser' then
    perform public.app__fail('Only the super user can do this.');
  end if;
  return u;
end $$;

-- May this user edit the data behind one tool? The super user: every editable tool. A tile
-- admin: every editable tool on his tiles. Users: only the tools they were granted, and only
-- while the tool is editable and they can open its tile.
create or replace function public.app__can_edit(u public.app_users, p_tool_id text)
returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.app_tools t
     where t.id = p_tool_id and t.editable
       and (public.app__is_tile_admin(u, t.category_id)
            or (exists (select 1 from public.app_tool_editors e where e.user_id = u.id and e.tool_id = t.id)
                and exists (select 1 from public.app_categories c
                             where c.id = t.category_id
                               and (c.is_default or exists (select 1 from public.app_user_categories uc
                                                             where uc.user_id = u.id and uc.category_id = c.id))))));
$$;

-- Session user who may edit the given tool, or raises.
create or replace function public.app__require_editor(p_token text, p_tool_id text)
returns public.app_users
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  if not public.app__can_edit(u, p_tool_id) then
    perform public.app__fail('Edit access for this tool is required.');
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
                               'created_at', u.created_at, 'last_login_at', u.last_login_at,
                               -- the tiles this person is admin of (the super user: all of them)
                               'admin_categories', coalesce((select jsonb_agg(c.id order by c.sort, c.name) from public.app_categories c
                                                              where public.app__is_tile_admin(u, c.id)), '[]'::jsonb),
                               'edit_tools', coalesce((select jsonb_agg(t.id order by t.id) from public.app_tools t
                                                        where public.app__can_edit(u, t.id)), '[]'::jsonb)),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'description', c.description, 'allowed', true,
               'admin', public.app__is_tile_admin(u, c.id),
               'tools', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', t.id, 'name', t.name, 'description', t.description,
                            'path', t.path, 'status', t.status, 'project_tool', t.project_tool,
                            'can_edit', public.app__can_edit(u, t.id)) order by t.sort, t.name)
                     from public.app_tools t
                    where t.category_id = c.id and t.status <> 'hidden'), '[]'::jsonb)
             ) order by c.sort, c.name)
        from public.app_categories c
       where c.is_default or public.app__is_tile_admin(u, c.id)
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
  -- One session per user: signing in ends this user's earlier session (another PC or browser).
  delete from public.app_sessions where expires_at < now() or user_id = u.id;
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
declare a public.app_users;
begin
  a := public.app__require_admin(p_token);
  return jsonb_build_object(
    -- the tiles the caller may manage: all for the super user, his own for a tile admin
    'scope', coalesce((select jsonb_agg(c.id order by c.sort, c.name) from public.app_categories c
                        where public.app__is_tile_admin(a, c.id)), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'username', u.username, 'full_name', u.full_name,
               'team_note', u.team_note, 'role', u.role, 'status', u.status,
               'created_at', u.created_at, 'last_login_at', u.last_login_at,
               'categories', coalesce((select jsonb_agg(uc.category_id order by uc.category_id)
                                         from public.app_user_categories uc
                                        where uc.user_id = u.id), '[]'::jsonb),
               'admin_categories', coalesce((select jsonb_agg(ca.category_id order by ca.category_id)
                                               from public.app_category_admins ca
                                              where ca.user_id = u.id), '[]'::jsonb),
               'edit_tools', coalesce((select jsonb_agg(e.tool_id order by e.tool_id)
                                         from public.app_tool_editors e
                                        where e.user_id = u.id), '[]'::jsonb)
             ) order by (u.status = 'pending') desc, u.created_at desc)
        from public.app_users u), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'is_default', c.is_default)
                       order by c.sort, c.name)
        from public.app_categories c), '[]'::jsonb),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category_id', t.category_id,
                                          'description', t.description, 'path', t.path,
                                          'status', t.status, 'sort', t.sort, 'editable', t.editable)
                       order by t.category_id, t.sort, t.name)
        from public.app_tools t), '[]'::jsonb)
  );
end $$;

-- Approve / reject / disable a user, set which tiles they may open, which tiles they are admin
-- of, and which tools they may edit.
--   The super user: everything, for everyone but himself. Only he makes a tile admin
--     (p_admin_categories; null = leave as it is).
--   A tile admin: ordinary users only, and only inside his own tiles: their access to those
--     tiles and "Can edit" for the tools on them. What a user has on other tiles is left alone.
--   p_role is kept for older pages and is ignored: the role follows the admin tiles.
drop function if exists public.app_admin_set_user(text, uuid, text, text, text[]);
drop function if exists public.app_admin_set_user(text, uuid, text, text, text[], text[]);
create or replace function public.app_admin_set_user(
  p_token text, p_user_id uuid, p_status text, p_role text, p_categories text[],
  p_edit_tools text[] default '{}'::text[], p_admin_categories text[] default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users;
  t public.app_users;
  v_super boolean;
  v_scope text[];
  v_cats text[] := coalesce(p_categories, '{}'::text[]);
  v_tools text[] := coalesce(p_edit_tools, '{}'::text[]);
begin
  a := public.app__require_admin(p_token);
  v_super := a.role = 'superuser';
  select * into t from public.app_users where id = p_user_id;
  if t.id is null then perform public.app__fail('User not found.'); end if;
  if p_status not in ('pending','approved','rejected','disabled') then
    perform public.app__fail('Invalid status.');
  end if;
  if t.role = 'superuser' then
    if p_status <> 'approved' then perform public.app__fail('The super user account cannot be demoted or disabled.'); end if;
    return jsonb_build_object('ok', true);            -- the super user has everything; nothing to store
  end if;
  if not v_super and t.role <> 'user' then
    perform public.app__fail('Only the super user can change an admin account.');
  end if;
  if not v_super and p_admin_categories is not null and exists (
       select 1 from unnest(p_admin_categories) x
        where not exists (select 1 from public.app_category_admins ca where ca.user_id = t.id and ca.category_id = x)) then
    perform public.app__fail('Only the super user can make someone an admin.');
  end if;
  select coalesce(array_agg(c.id), '{}'::text[]) into v_scope from public.app_categories c where public.app__is_tile_admin(a, c.id);

  update public.app_users
     set status = p_status,
         approved_by = case when p_status = 'approved' and t.status <> 'approved' then a.id else approved_by end,
         approved_at = case when p_status = 'approved' and t.status <> 'approved' then now() else approved_at end,
         failed_attempts = 0,
         locked_until = null
   where id = t.id;

  -- admin tiles: the super user only
  if v_super and p_admin_categories is not null then
    delete from public.app_category_admins where user_id = t.id and not (category_id = any(p_admin_categories));
    insert into public.app_category_admins (user_id, category_id, granted_by)
    select t.id, c.id, a.id from public.app_categories c where c.id = any(p_admin_categories)
    on conflict do nothing;
    update public.app_users u
       set role = case when exists (select 1 from public.app_category_admins ca where ca.user_id = u.id) then 'admin' else 'user' end
     where u.id = t.id;
  end if;

  -- tile access, inside the caller's tiles only
  delete from public.app_user_categories where user_id = t.id and category_id = any(v_scope);
  insert into public.app_user_categories (user_id, category_id)
  select t.id, c.id from public.app_categories c
   where c.id = any(v_cats) and c.id = any(v_scope) and not c.is_default
  on conflict do nothing;

  -- per-tool edit rights, for tools on the caller's tiles only, and only tools that have an edit screen
  delete from public.app_tool_editors e using public.app_tools tl
   where e.user_id = t.id and tl.id = e.tool_id and tl.category_id = any(v_scope);
  insert into public.app_tool_editors (user_id, tool_id, granted_by)
  select t.id, tl.id, a.id from public.app_tools tl
   where tl.id = any(v_tools) and tl.editable and tl.category_id = any(v_scope)
  on conflict do nothing;

  if p_status <> 'approved' then
    delete from public.app_sessions where user_id = t.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_admin_reset_password(
  p_token text, p_user_id uuid, p_new_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.app_users;
begin
  a := public.app__require_admin(p_token);
  perform public.app__check_password(p_new_password);
  if a.role <> 'superuser' and exists (select 1 from public.app_users x where x.id = p_user_id and x.role <> 'user') then
    perform public.app__fail('Only the super user can reset an admin password.');
  end if;
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
  a := public.app__require_super(p_token);
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

-- Add or edit a tool (the tile contents). Superuser only. New category tiles are added the same way.
--   p_editable: the tool has an edit screen, so admins and chosen users can be given write access to it.
drop function if exists public.app_admin_save_tool(text, text, text, text, text, text, text, int);
create or replace function public.app_admin_save_tool(
  p_token text, p_id text, p_category_id text, p_name text,
  p_description text, p_path text, p_status text, p_sort int default 100,
  p_editable boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_super(p_token);
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
  insert into public.app_tools (id, category_id, name, description, path, status, sort, editable)
  values (p_id, p_category_id, trim(p_name), trim(coalesce(p_description, '')),
          coalesce(p_path, ''), p_status, coalesce(p_sort, 100), coalesce(p_editable, false))
  on conflict (id) do update
     set category_id = excluded.category_id, name = excluded.name,
         description = excluded.description, path = excluded.path,
         status = excluded.status, sort = excluded.sort, editable = excluded.editable;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_admin_save_category(
  p_token text, p_id text, p_name text, p_description text,
  p_sort int default 100, p_is_default boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_super(p_token);
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

-- Where a clause sits in the specification: its Part (1 General, 2 Products, 3 Execution, 0 = not known)
-- and the title of its section ("FANS"). The topic shown in the library ("Fans and drives") is worked
-- out from the section title by cm__topic, so improving that function re-sorts every line at once.
alter table public.cm_lines add column if not exists part    int  not null default 0;
alter table public.cm_lines add column if not exists section text not null default '';
create index if not exists cm_lines_part_idx on public.cm_lines (factory_id, part);
-- Where the clause was first seen, so the library can be read like the specification it came from:
-- the conversion (home_run), its position in it (home_seq), its own label (sr: A, 1, a) and row type,
-- and the number of its section there (section_sr: 1.07).
alter table public.cm_lines add column if not exists home_run   uuid references public.cm_runs(id) on delete set null;
alter table public.cm_lines add column if not exists home_seq   int;
alter table public.cm_lines add column if not exists sr         text not null default '';
alter table public.cm_lines add column if not exists row_type   text not null default '';
alter table public.cm_lines add column if not exists section_sr text not null default '';
-- Internal Comments: notes for the library team only. Never written into a user's compliance sheet.
alter table public.cm_lines add column if not exists comments   text not null default '';

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

-- "PART 2 - PRODUCTS" -> 2. Anything else -> 0.
create or replace function public.cm__part_no(t text) returns int
language sql immutable as $$
  select case
    when m is null then 0
    when upper(m[1]) = 'I' then 1 when upper(m[1]) = 'II' then 2 when upper(m[1]) = 'III' then 3
    when m[1] ~ '^[0-9]+$' then least(m[1]::int, 9)
    else 0 end
  from (select regexp_match(coalesce(t, ''), '^\s*PART\s+([0-9]{1,2}|I{1,3})\M', 'i') as m) x;
$$;

-- Section title -> one of a short fixed list of topics, so "FANS", "Supply Fan Section" and
-- "BEARINGS AND DRIVES" land in the same group. First match wins. The one place this is decided
-- (the demo back end in api.js mirrors it).
create or replace function public.cm__topic(t text) returns text
language sql immutable as $$
  select case
    when s = '' then ''
    when s ~ '\m(field quality|install|examin|prepar|adjust|clean|demonstrat|commission|start.?up|testing|connection|training)' then 'Installation and testing'
    when s ~ '\m(submittal|shop drawing|closeout)' then 'Submittals'
    when s ~ '\m(quality|warrant|regulat|certif|standard|reference|performance|health|safety|code)' then 'Standards and quality'
    when s ~ '\m(filter)' then 'Filters'
    when s ~ '\m(humidif|dehumidif)' then 'Humidifier'
    when s ~ '\m(heat recovery|recovery wheel|heat wheel|heat pipe|recuperator|run.?around)' then 'Heat recovery'
    when s ~ '\m(coil|heat exchanger|eliminator|drain pan)' then 'Coils'
    when s ~ '\m(damper|mixing|plenum|louv|economi)' then 'Dampers and mixing'
    when s ~ '\m(sound|noise|acoustic|attenuat|silencer|vibration)' then 'Sound and vibration'
    when s ~ '\m(fan|blower|motor|drive|bearing|belt)' then 'Fans and drives'
    when s ~ '\m(control|electric|wiring|starter|variable frequency|vfd|instrument|sensor)' then 'Controls and electrical'
    when s ~ '\m(casing|cabinet|enclosure|panel|housing|construction|gasket|door|insulat|base|frame|support|roof)' then 'Casing and base'
    when s ~ '\m(deliver|storage|extra material|spare|maintenance)' then 'Delivery and spares'
    when s ~ '\m(general|summary|description|scope|includes|related|definition|coordination|manufacturer|material)' then 'General'
    else 'Other' end
  from (select lower(coalesce(t, '')) as s) x;
$$;

-- Fill Part and section of library lines from the saved conversions (cm_run_lines keeps every
-- row of every conversion in order). A line takes the Part and section it was first seen under;
-- a value already there is never changed. The same first sighting gives the line its place in the
-- library (home_run, home_seq, sr, row_type, section_sr). p_run = one conversion, or null for all.
create or replace function public.cm__fill_structure(p_run uuid default null) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  update public.cm_lines l
     set part       = case when l.part = 0 then s.part else l.part end,
         section    = case when l.section = '' then s.section else l.section end,
         home_run   = coalesce(l.home_run, s.run_id),
         home_seq   = case when l.home_run is null then s.seq else l.home_seq end,
         sr         = case when l.home_run is null then s.sr else l.sr end,
         row_type   = case when l.home_run is null then s.type else l.row_type end,
         section_sr = case when l.home_run is null then s.section_sr else l.section_sr end
    from (
      select distinct on (rl.line_id) rl.line_id, rl.run_id, rl.seq, rl.sr, rl.type,
             coalesce(pp.part, 0) as part, coalesce(ss.title, '') as section, coalesce(ss.sr, '') as section_sr
        from public.cm_run_lines rl
        join public.cm_runs r on r.id = rl.run_id
        left join lateral (
          select x.seq, public.cm__part_no(x.spec_text) as part
            from public.cm_run_lines x
           where x.run_id = rl.run_id and x.type = 'part' and x.seq < rl.seq
             and public.cm__part_no(x.spec_text) > 0
           order by x.seq desc limit 1) pp on true
        left join lateral (
          select left(trim(x.spec_text), 120) as title, left(trim(x.sr), 12) as sr
            from public.cm_run_lines x
           where x.run_id = rl.run_id and x.type = 'section' and x.seq < rl.seq
             and x.seq > coalesce(pp.seq, -1)
             and x.spec_text !~ '\.{5,}'            -- not a contents line
             and x.sr !~ '^0\.'                     -- not a wrapped "0.68 W/m2" line read as a section by older versions
           order by x.seq desc limit 1) ss on true
       where rl.line_id is not null and (p_run is null or rl.run_id = p_run)
       order by rl.line_id, r.created_at, rl.seq
    ) s
   where l.id = s.line_id
     and (l.home_run is null or (l.part = 0 and s.part > 0) or (l.section = '' and s.section <> ''));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Lines saved before Part and section existed: fill them from the conversions already stored.
do $$ begin perform public.cm__fill_structure(null); end $$;

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
drop function if exists public.cm_save_run(text, text, text, text, jsonb);
create or replace function public.cm_save_run(
  p_token text, p_factory_id text, p_source text, p_file_name text, p_lines jsonb, p_project_id uuid default null)
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

  -- p_project_id: the project this conversion is saved under (checked by pr__project)
  if p_project_id is not null then perform public.pr__project(u, p_project_id); end if;

  insert into public.cm_runs (kind, user_id, product_id, factory_id, source, file_name, project_id)
  values ('conversion', u.id, f.product_id, f.id,
          case when p_source in ('pdf','text') then p_source else '' end,
          left(coalesce(p_file_name, ''), 200), p_project_id)
  returning id into v_run;
  if p_project_id is not null then
    perform public.pr__log(p_project_id, u.id, 'Specification converted', left(coalesce(p_file_name, ''), 200));
  end if;

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
    select distinct on (norm) norm, spec from body
     where length(norm) >= 8 and spec !~ '\.{5,}'          -- not a contents line ("1.04 REFERENCES ........ 2")
     order by norm, seq
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
  perform public.cm__fill_structure(v_run);

  return jsonb_build_object('ok', true, 'run_id', v_run, 'lines', v_lines,
                            'unique_lines', v_unique, 'matched', v_matched, 'answers', v_answers);
end $$;

-- ---------- editor API (admins, and users given edit access to compliance-maker) ----------

-- One page of the library for a factory, unanswered and most-seen first.
-- The reading order of a factory's library, the one place it is decided:
--   Part 1, 2, 3 (part not known last)
--   then sections by title: every "QUALITY CONTROL" of every specification together, the groups in
--     the order of their lowest section number (1.05 before 1.07)
--   then, inside a title, one block per specification the clauses were first seen in, oldest first
--   then the clauses in the order they stand in that specification.
create or replace function public.cm__library_order(p_factory text)
returns table (line_id uuid, ord bigint, file_name text)
language sql stable security definer set search_path = public, extensions as $$
  select g.id,
         row_number() over (order by (g.part = 0), g.part, g.gsort, lower(g.section), g.run_at nulls last,
                                     g.home_run, g.home_seq nulls last, g.first_seen_at, g.id),
         g.file_name
    from (
      select l.id, l.part, l.section, l.home_run, l.home_seq, l.first_seen_at,
             r.created_at as run_at, coalesce(r.file_name, '') as file_name,
             min(case when l.section_sr ~ '^\d{1,2}\.\d{1,2}$'
                      then split_part(l.section_sr, '.', 1)::int * 1000 + split_part(l.section_sr, '.', 2)::int
                      else 99999 end) over (partition by l.part, lower(l.section)) as gsort
        from public.cm_lines l
        left join public.cm_runs r on r.id = l.home_run
       where l.factory_id = p_factory
    ) g;
$$;

-- p_part: null = every part, 0 = part not known, 1..3. p_topic: '' = every topic, or a cm__topic name.
-- p_status: open | answered | all | review (lines with a project answer waiting for a decision).
-- p_client_type / p_client_name: only lines met in a project of that client type / client.
-- Each line carries the answers users filled in their projects (who, project, client), so the
-- editor sees who filled what and can take an answer into the library.
drop function if exists public.cm_admin_lines(text, text, text, text, int, int);
drop function if exists public.cm_admin_lines(text, text, text, text, int, int, int, text);
create or replace function public.cm_admin_lines(
  p_token text, p_factory_id text, p_status text default 'open',
  p_search text default '', p_limit int default 100, p_offset int default 0,
  p_part int default null, p_topic text default '',
  p_client_type text default '', p_client_name text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f public.cm_factories;
  v_like text := '%' || replace(replace(replace(trim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_topic text := trim(coalesce(p_topic, ''));
  v_ct text := trim(coalesce(p_client_type, ''));
  v_cn text := trim(coalesce(p_client_name, ''));
  v_ids uuid[];
begin
  perform public.app__require_editor(p_token, 'compliance-maker');
  f := public.cm__factory(p_factory_id);
  -- the lines that pass every filter, once, for the count and the page
  select array_agg(l.id) into v_ids
    from public.cm_lines l
   where l.factory_id = f.id
     and (p_status = 'all' or l.status = p_status
          or (p_status = 'review' and exists (select 1 from public.cm_run_lines rl where rl.line_id = l.id and rl.review = 'pending')))
     and (p_part is null or l.part = p_part)
     and (v_topic = '' or public.cm__topic(l.section) = v_topic)
     and l.spec_text ilike v_like
     and ((v_ct = '' and v_cn = '') or exists (
            select 1 from public.cm_run_lines rl
              join public.cm_runs r on r.id = rl.run_id
              join public.pr_projects pj on pj.id = r.project_id
             where rl.line_id = l.id and (v_ct = '' or pj.client_type = v_ct) and (v_cn = '' or pj.client_name = v_cn)));
  return jsonb_build_object(
    'counts', (select jsonb_build_object('all', count(*),
                        'open', count(*) filter (where status = 'open'),
                        'answered', count(*) filter (where status = 'answered'),
                        'review', count(*) filter (where exists (select 1 from public.cm_run_lines rl where rl.line_id = cm_lines.id and rl.review = 'pending')))
                 from public.cm_lines where factory_id = f.id),
    -- every Part / topic of this factory with its line counts, for the two filters
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('part', g.part, 'topic', g.topic, 'all', g.n, 'open', g.o)
                       order by (g.part = 0), g.part, g.topic)
        from (select l.part, public.cm__topic(l.section) as topic, count(*) as n,
                     count(*) filter (where l.status = 'open') as o
                from public.cm_lines l where l.factory_id = f.id group by 1, 2) g), '[]'::jsonb),
    -- client types and client names of the projects that used this factory, for the two client filters
    'client_types', coalesce((select jsonb_agg(distinct pj.client_type) from public.cm_runs r join public.pr_projects pj on pj.id = r.project_id
                               where r.factory_id = f.id), '[]'::jsonb),
    'client_names', coalesce((select jsonb_agg(distinct pj.client_name) from public.cm_runs r join public.pr_projects pj on pj.id = r.project_id
                               where r.factory_id = f.id and (v_ct = '' or pj.client_type = v_ct)), '[]'::jsonb),
    'total', coalesce(array_length(v_ids, 1), 0),
    'lines', coalesce((
      select jsonb_agg(x.j order by x.rn) from (
        select row_number() over (order by o.ord) as rn,
               jsonb_build_object('id', l.id, 'spec_text', l.spec_text, 'compliance', l.compliance,
                 'remarks', l.remarks, 'comments', l.comments, 'status', l.status, 'times_seen', l.times_seen,
                 'last_seen_at', l.last_seen_at, 'answered_at', l.answered_at,
                 'answer_source', l.answer_source,
                 'part', l.part, 'section', l.section, 'topic', public.cm__topic(l.section),
                 'sr', l.sr, 'row_type', l.row_type, 'section_sr', l.section_sr,
                 'home_run', l.home_run, 'file_name', o.file_name,
                 'answered_by', (select au.full_name from public.app_users au where au.id = l.answered_by),
                 'project_answers', coalesce((
                    select jsonb_agg(pa.j order by pa.k, pa.at desc) from (
                      select case rl.review when 'pending' then 0 else 1 end as k, rl.answered_at as at,
                             jsonb_build_object('run', rl.run_id, 'seq', rl.seq, 'compliance', rl.compliance, 'remarks', rl.remarks,
                               'review', rl.review, 'by', public.pr__name(rl.answered_by), 'at', rl.answered_at,
                               'project', pj.name, 'client', pj.client_name, 'client_type', pj.client_type, 'region', pj.region) as j
                        from public.cm_run_lines rl
                        join public.cm_runs r on r.id = rl.run_id
                        join public.pr_projects pj on pj.id = r.project_id
                       where rl.line_id = l.id and (rl.compliance <> '' or rl.remarks <> '')
                       order by 1, 2 desc limit 6) pa), '[]'::jsonb)) as j
          from public.cm__library_order(f.id) o
          join public.cm_lines l on l.id = o.line_id
         where l.id = any(coalesce(v_ids, '{}'::uuid[]))
         order by o.ord
         limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb));
end $$;

-- Fill in (or clear) the answer for one library line. p_comments = the Internal Comments;
-- null leaves them as they are. The comments alone do not make a line "answered".
drop function if exists public.cm_admin_save_answer(text, uuid, text, text);
create or replace function public.cm_admin_save_answer(
  p_token text, p_line_id uuid, p_compliance text, p_remarks text, p_comments text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users;
  v_c text := left(trim(coalesce(p_compliance, '')), 200);
  v_r text := left(trim(coalesce(p_remarks, '')), 4000);
  l public.cm_lines; o public.cm_lines;
begin
  a := public.app__require_editor(p_token, 'compliance-maker');
  select * into o from public.cm_lines where id = p_line_id;
  if o.id is null then perform public.app__fail('That line no longer exists.'); end if;
  if p_comments is not null then
    update public.cm_lines set comments = left(trim(p_comments), 4000) where id = p_line_id;
  end if;
  if (o.compliance, o.remarks) is not distinct from (v_c, v_r) then      -- only the comments changed
    return jsonb_build_object('ok', true, 'status', o.status);
  end if;
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
  perform public.app__require_editor(p_token, 'compliance-maker');
  delete from public.cm_lines where id = p_line_id;
  if not found then perform public.app__fail('That line no longer exists.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Load a filled compliance sheet into the library. One format for every product:
--   Sr | Specifications | Compliance | Remarks | Internal Comments
--   p_rows: [{ "spec", "compliance", "remarks", "comments", "sr", "type", "part", "section", "section_sr" }, ...]
--   (the page works out part / section / type from the PART rows, section rows and Sr of the sheet)
-- Rows with an answer or an internal comment are taken; when the same clause appears twice in
-- the file the last one wins. A new clause becomes a library line in its Part and section. A
-- line with no answer yet is filled. A line that already has an answer gets the file's answer
-- instead (owner's rule, 5 Oct 2026 evening: an editor's uploaded file REPLACES existing
-- answers; counted as "replaced"). The same goes for the internal comments the file carries.
-- Only this upload and an editor typing on the screen change an existing answer; a conversion
-- or a user's project answer never does.
create or replace function public.cm_admin_import(
  p_token text, p_factory_id text, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users;
  f public.cm_factories;
  v_run uuid;
  v_total int; v_unique int; v_added int; v_updated int; v_kept int;
begin
  a := public.app__require_editor(p_token, 'compliance-maker');
  f := public.cm__factory(p_factory_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.app__fail('No rows were found in that file.');
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 20000 then perform public.app__fail('That file has more than 20000 rows. Split it and upload in parts.'); end if;

  insert into public.cm_runs (kind, user_id, product_id, factory_id, source, file_name, line_count)
  values ('library-upload', a.id, f.product_id, f.id, 'xlsx', left(coalesce(p_file_name, ''), 200), v_total)
  returning id into v_run;

  create temp table if not exists cm__import_tmp (
    norm text, spec text, c text, r text, cm text, sr text, row_type text, part int, section text, section_sr text, ord int,
    was_there boolean, was_answered boolean, old_c text, old_r text) on commit drop;
  truncate cm__import_tmp;
  insert into cm__import_tmp (norm, spec, c, r, cm, sr, row_type, part, section, section_sr, ord)
  select distinct on (public.cm__norm(x.spec)) public.cm__norm(x.spec), trim(x.spec), x.c, x.r, x.cm, x.sr, x.row_type, x.part, x.section, x.section_sr, x.ord
    from (select e.ord::int as ord,
                 left(coalesce(e.val->>'spec', ''), 6000) as spec,
                 left(trim(coalesce(e.val->>'compliance', '')), 200) as c,
                 left(trim(coalesce(e.val->>'remarks', '')), 4000)   as r,
                 left(trim(coalesce(e.val->>'comments', '')), 4000)  as cm,
                 left(trim(coalesce(e.val->>'sr', '')), 20) as sr,
                 case when e.val->>'type' in ('letter', 'number', 'text') then e.val->>'type' else 'text' end as row_type,
                 case when (e.val->>'part') ~ '^[0-9]$' then (e.val->>'part')::int else 0 end as part,
                 left(trim(coalesce(e.val->>'section', '')), 120) as section,
                 left(trim(coalesce(e.val->>'section_sr', '')), 20) as section_sr
            from jsonb_array_elements(p_rows) with ordinality as e(val, ord)) x
   where (x.c <> '' or x.r <> '' or x.cm <> '') and length(public.cm__norm(x.spec)) >= 8
   order by public.cm__norm(x.spec), x.ord desc;
  update cm__import_tmp t set was_there = true, was_answered = (l.status = 'answered'), old_c = l.compliance, old_r = l.remarks
    from public.cm_lines l where l.factory_id = f.id and l.norm_hash = md5(t.norm);

  -- new clauses
  insert into public.cm_lines (product_id, factory_id, norm_hash, norm_text, spec_text, compliance, remarks, comments,
                               status, first_run_id, answered_by, answered_at, answer_source, times_seen,
                               part, section, sr, row_type, section_sr, home_run, home_seq)
  select f.product_id, f.id, md5(t.norm), t.norm, t.spec, t.c, t.r, t.cm,
         case when t.c <> '' or t.r <> '' then 'answered' else 'open' end, v_run,
         case when t.c <> '' or t.r <> '' then a.id end, case when t.c <> '' or t.r <> '' then now() end,
         case when t.c <> '' or t.r <> '' then 'upload' else '' end, 0,
         t.part, t.section, t.sr, t.row_type, t.section_sr, v_run, t.ord
    from cm__import_tmp t where t.was_there is not true
  on conflict (factory_id, norm_hash) do nothing;
  -- lines already in the library take the file's answer: open ones are filled, answered ones replaced
  update public.cm_lines l
     set compliance = t.c, remarks = t.r, status = 'answered', answered_by = a.id, answered_at = now(), answer_source = 'upload'
    from cm__import_tmp t
   where l.factory_id = f.id and l.norm_hash = md5(t.norm) and t.was_there and (t.c <> '' or t.r <> '')
     and (l.compliance, l.remarks) is distinct from (t.c, t.r);
  -- and the file's internal comments
  update public.cm_lines l set comments = t.cm
    from cm__import_tmp t
   where l.factory_id = f.id and l.norm_hash = md5(t.norm) and t.was_there and t.cm <> '' and l.comments is distinct from t.cm;
  insert into public.cm_answer_log (line_id, compliance, remarks, source, run_id, user_id)
  select l.id, t.c, t.r, 'upload', v_run, a.id
    from cm__import_tmp t join public.cm_lines l on l.factory_id = f.id and l.norm_hash = md5(t.norm)
   where (t.c <> '' or t.r <> '') and (t.was_there is not true or t.was_answered is not true or (t.old_c, t.old_r) is distinct from (t.c, t.r));

  select count(*) filter (where c <> '' or r <> ''),
         count(*) filter (where was_there is not true and (c <> '' or r <> '')),
         count(*) filter (where was_there and was_answered is not true and (c <> '' or r <> '')),
         count(*) filter (where was_answered and (c <> '' or r <> '') and (old_c, old_r) is distinct from (c, r))
    into v_unique, v_added, v_updated, v_kept from cm__import_tmp;

  update public.cm_runs set unique_count = v_unique, matched_count = v_added + v_updated where id = v_run;
  return jsonb_build_object('ok', true, 'rows', v_total, 'unique_lines', v_unique,
                            'added', v_added, 'updated', v_updated, 'replaced', v_kept,
                            'unchanged', v_unique - v_added - v_updated - v_kept,
                            'skipped', v_total - v_unique);
end $$;

-- Recent conversions and uploads, newest first.
create or replace function public.cm_admin_runs(p_token text, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_editor(p_token, 'compliance-maker');
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
  perform public.app__require_editor(p_token, 'compliance-maker');
  f := public.cm__factory(p_factory_id);
  return jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object('spec_text', l.spec_text, 'compliance', l.compliance,
                                        'remarks', l.remarks, 'comments', l.comments, 'times_seen', l.times_seen,
                                        'part', l.part, 'section', l.section, 'topic', public.cm__topic(l.section),
                                        'sr', l.sr, 'row_type', l.row_type, 'section_sr', l.section_sr,
                                        'home_run', l.home_run, 'file_name', o.file_name)
                     order by o.ord)
      from public.cm__library_order(f.id) o
      join public.cm_lines l on l.id = o.line_id), '[]'::jsonb));
end $$;

-- ---------- the super user (SQL Editor only, never from the website) ----------
-- After running this file on a NEW database, create yourself ONCE with:
--     select public.app_bootstrap_admin('your.username', 'Your Full Name', 'a-strong-password');
-- That account is the super user. Admins are then made on the website (Admin > Users > Role).
create or replace function public.app_bootstrap_admin(p_username text, p_full_name text, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from public.app_users where role = 'superuser') then
    return 'A super user already exists. Use the Admin page on the website, or app_set_superuser to move it.';
  end if;
  perform public.app__check_password(p_password);
  insert into public.app_users (username, full_name, pass_hash, role, status, approved_at)
  values (trim(p_username), trim(p_full_name), crypt(p_password, gen_salt('bf', 10)), 'superuser', 'approved', now());
  return 'Super user created. You can now log in on the website.';
end $$;

-- Move the super user role to another approved account (the old super user becomes an admin):
--     select public.app_set_superuser('username');
create or replace function public.app_set_superuser(p_username text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t public.app_users;
begin
  select * into t from public.app_users where lower(username) = lower(trim(coalesce(p_username, '')));
  if t.id is null then return 'No user with that username.'; end if;
  if t.status <> 'approved' then return 'That user is not approved yet.'; end if;
  -- the old super user becomes admin of every tile
  insert into public.app_category_admins (user_id, category_id)
  select u.id, c.id from public.app_users u cross join public.app_categories c where u.role = 'superuser' and u.id <> t.id
  on conflict do nothing;
  update public.app_users set role = 'admin' where role = 'superuser' and id <> t.id;
  delete from public.app_category_admins where user_id = t.id;
  update public.app_users set role = 'superuser' where id = t.id;
  return 'Super user is now ' || t.username || '.';
end $$;

-- ============================================================
-- DATASHEET NOTES - row mapping
--
-- The Datasheet Notes tool reads product datasheets in the browser and builds a
-- Section / Component / one column per unit / Remarks table. Editors decide, per
-- PRODUCT (one mapping for all factories), which rows go into that table and what each says:
--   dn_map            one row per datasheet row (key = section | sub-heading | component)
--                       show      false = the row is left out
--                       label     name to print in the Component column ('' = as on the datasheet)
--                       strip     text to take out of the datasheet value first, e.g. '+ PE'
--                                 (several texts separated by ;)
--                       response  '' = datasheet value; text = standard response;
--                                 $ or * in the text = where the datasheet value goes
--                       keywords  words that find this row's clause in a specification (Compliance
--                                 Maker, sheet "Datasheet rows"). Entries separated by ; . An entry
--                                 matches a clause when every word of it starts a word of the clause.
--                       reviewed  false = added automatically from a user's datasheet and not
--                                 yet looked at by an editor (shown as "New" on the mapping screen)
--   dn_map_settings   per product: are rows with no rule shown or hidden
-- Every run of the tool by any user adds the row names it has not seen before
-- (dn_add_rows), so the mapping list keeps growing on its own. Only names are
-- stored. The datasheet and its values are never stored.
--
-- dn_rules / dn_settings are the first version, kept per factory. They are no longer read
-- or written; their content is copied into dn_map once (below) and they stay as a backup.
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

create table if not exists public.dn_map (
  product_id text not null references public.cm_products(id) on delete cascade,
  row_key    text not null,
  section    text not null default '',
  sub        text not null default '',
  component  text not null default '',
  show       boolean not null default true,
  label      text not null default '',
  strip      text not null default '',
  response   text not null default '',
  sort       int  not null default 0,
  reviewed   boolean not null default true,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (product_id, row_key)
);

create table if not exists public.dn_map_settings (
  product_id    text primary key references public.cm_products(id) on delete cascade,
  show_unmapped boolean not null default true,
  updated_by    uuid references public.app_users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table public.dn_map add column if not exists keywords text not null default '';

alter table public.dn_map          enable row level security;
alter table public.dn_map_settings enable row level security;
revoke all on public.dn_map, public.dn_map_settings from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.dn_map, public.dn_map_settings from anon, authenticated;
  end if;
end $$;

-- One-time copy of the per-factory mappings into the per-product mapping. It runs only for a
-- product that has no rows in dn_map yet, so re-running this file never brings back a row an
-- editor removed. Where two factories hold the same row, the one an editor has worked on wins
-- (reviewed, then one with a name / response / left out, then the most recently saved).
insert into public.dn_map (product_id, row_key, section, sub, component, show, label, response, sort, reviewed, updated_by, updated_at)
select distinct on (f.product_id, r.row_key)
       f.product_id, r.row_key, r.section, r.sub, r.component, r.show, r.label, r.response, r.sort, r.reviewed, r.updated_by, r.updated_at
  from public.dn_rules r
  join public.cm_factories f on f.id = r.factory_id
 where not exists (select 1 from public.dn_map m where m.product_id = f.product_id)
 order by f.product_id, r.row_key, r.reviewed desc,
          (r.label <> '' or r.response <> '' or not r.show) desc, r.updated_at desc
on conflict (product_id, row_key) do nothing;

insert into public.dn_map_settings (product_id, show_unmapped, updated_by, updated_at)
select distinct on (f.product_id) f.product_id, s.show_unmapped, s.updated_by, s.updated_at
  from public.dn_settings s
  join public.cm_factories f on f.id = s.factory_id
 order by f.product_id, s.updated_at desc
on conflict (product_id) do nothing;

-- Starter keywords for the AHU rows, so the "Datasheet rows" sheet finds something on day one.
-- Runs only while no AHU row has keywords, so it never overwrites or brings back what an editor
-- typed or cleared. Editors change them on the Row mapping screen.
update public.dn_map m set keywords = k.keywords
  from (values
    ('general||power supply',                          'power supply; electrical characteristic; volt phase'),
    ('unit data||panel',                               'double wall; double skin; panel thick; casing thick; wall thick'),
    ('unit data||insulation',                          'insulation; glass fiber; mineral wool; rockwool; polyurethane; injected foam; thermal conductance'),
    ('unit data||panel inner skin',                    'inner panel; inside casing; inner skin; inner sheet; interior panel'),
    ('unit data||panel outer skin',                    'outer panel; outside casing; outer skin; outer sheet; exterior panel'),
    ('unit data||profile',                             'thermal break; frame profile; aluminium profile; aluminum profile; support channel'),
    ('unit data||ahu base',                            'base rail; base frame; steel base; channel base'),
    ('unit data||roof',                                'roof; outdoor install; weatherproof; weather resistant; canopy'),
    ('unit data||door',                                'access door; inspection door; hinge'),
    ('unit data||supply air flow',                     'airflow rate; air quantity; design air flow'),
    ('unit data||external pressure drop',              'external static'),
    ('unit data||sfpv (clean filters)',                'specific fan power; sfp'),
    ('unit data||erp compliant',                       'erp; ecodesign'),
    ('mixing box supply||drain pan',                   'drain pan'),
    ('mixing box supply|damper one supply|material',   'damper blade; damper galvan; damper alumin; blade damper'),
    ('filter supply||filter class',                    'filter efficien; filter class; panel filter; bag filter; hepa; extended surface; dust spot'),
    ('filter supply||material',                        'filter media'),
    ('filter supply||dirty pressure drop',             'final resistance; dirty filter; filter pressure drop'),
    ('coil cooling dx supply|geometry|rows',           'rows deep; coil rows; row coil'),
    ('coil cooling dx supply|geometry|frame',          'coil frame; coil casing; channel frame'),
    ('coil cooling dx supply|geometry|tube material',  'copper tube; tube material; seamless copper'),
    ('coil cooling dx supply|geometry|tube thickness', 'tube wall thick; tube thick'),
    ('coil cooling dx supply|geometry|fin material',   'fin alumin; fin copper; fin material; fin coated'),
    ('coil cooling dx supply|geometry|fin space',      'fins per; fin spac; fpi'),
    ('coil cooling dx supply|geometry|air velocity',   'face velocity'),
    ('coil cooling dx supply|geometry|drain pan',      'drain pan'),
    ('coil cooling dx supply|cooling|total capacity',  'cooling capacity; total capacity'),
    ('fan supply||type',                               'centrifugal fan; plug fan; plenum fan; ec fan; backward curved; forward curved; fan type'),
    ('fan supply||efficiency',                         'fan efficien; static efficien'),
    ('fan supply|motor data|efficiency class',         'motor efficien; ie2; ie3; ie4; ie5; premium efficien'),
    ('fan supply|motor data|electrical connection',    'motor volt; motor phase')
  ) as k(row_key, keywords)
 where m.product_id = 'ahu' and m.row_key = k.row_key
   and not exists (select 1 from public.dn_map x where x.product_id = 'ahu' and x.keywords <> '');

-- The functions keep their names but now take a product, not a factory. A parameter cannot be
-- renamed in place, so the old ones are dropped first.
drop function if exists public.dn_get_rules(text, text);
drop function if exists public.dn_add_rows(text, text, jsonb);
drop function if exists public.dn_admin_save_rules(text, text, boolean, jsonb, jsonb);

create or replace function public.dn__product(p_product_id text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.cm_products p where p.id = p_product_id and p.active) then
    perform public.app__fail('Choose a product first.');
  end if;
  return p_product_id;
end $$;

-- The mapping for one product. Any approved user: the tool needs it to build the table.
create or replace function public.dn_get_rules(p_token text, p_product_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_product text;
begin
  perform public.app__session_user(p_token);
  v_product := public.dn__product(p_product_id);
  return jsonb_build_object(
    'show_unmapped', coalesce((select s.show_unmapped from public.dn_map_settings s where s.product_id = v_product), true),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.row_key, 'section', r.section, 'sub', r.sub,
               'component', r.component, 'show', r.show, 'label', r.label, 'strip', r.strip,
               'response', r.response, 'keywords', r.keywords, 'new', not r.reviewed)
             order by r.sort, r.row_key)
        from public.dn_map r where r.product_id = v_product), '[]'::jsonb));
end $$;

-- Called by the tool after every datasheet it reads, for any approved user.
-- Adds the rows this product's mapping has not seen before; rows already there are not touched.
--   p_rows: [{ "key", "section", "sub", "component" }, ...] in datasheet order
-- A new row starts as shown or left out according to the product's "rows not in the list yet"
-- setting, with the datasheet value, and is marked for the editors to review.
create or replace function public.dn_add_rows(p_token text, p_product_id text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_product text;
  v_show boolean; v_base int; v_added int := 0;
begin
  perform public.app__session_user(p_token);
  v_product := public.dn__product(p_product_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    perform public.app__fail('The rows could not be read.');
  end if;
  if jsonb_array_length(p_rows) > 3000 then
    perform public.app__fail('Too many rows to add in one go (more than 3000).');
  end if;
  v_show := coalesce((select s.show_unmapped from public.dn_map_settings s where s.product_id = v_product), true);
  v_base := coalesce((select max(r.sort) from public.dn_map r where r.product_id = v_product), 0);

  insert into public.dn_map (product_id, row_key, section, sub, component, show, sort, reviewed)
  select v_product, x.key, x.section, x.sub, x.component, v_show, v_base + x.ord, false
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
  on conflict (product_id, row_key) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('ok', true, 'added', v_added);
end $$;

-- Save the mapping for one product (admins, and users given edit access to datasheet-notes).
--   p_rules:  [{ "key", "section", "sub", "component", "show", "label", "strip", "response" }, ...] in display order.
--             Rows already stored and not in the list are kept as they are.
--   p_remove: ["key", ...] rules to delete.
create or replace function public.dn_admin_save_rules(
  p_token text, p_product_id text, p_show_unmapped boolean, p_rules jsonb, p_remove jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  v_product text;
  v_saved int := 0; v_removed int := 0;
begin
  u := public.app__require_editor(p_token, 'datasheet-notes');
  v_product := public.dn__product(p_product_id);
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
              where length(coalesce(e->>'label', '')) > 120 or length(coalesce(e->>'response', '')) > 1000
                 or length(coalesce(e->>'strip', '')) > 300 or length(coalesce(e->>'keywords', '')) > 600) then
    perform public.app__fail('A name is longer than 120 characters, a "remove text" is longer than 300, the keywords are longer than 600, or a response is longer than 1000.');
  end if;

  delete from public.dn_map r
   where r.product_id = v_product
     and r.row_key in (select jsonb_array_elements_text(p_remove));
  get diagnostics v_removed = row_count;

  insert into public.dn_map (product_id, row_key, section, sub, component, show, label, strip, response, keywords, sort, updated_by, updated_at, reviewed)
  select v_product, x.key, x.section, x.sub, x.component, x.show, x.label, x.strip, x.response, x.keywords, x.sort, u.id, now(), true
    from (
      select distinct on (trim(e->>'key'))
             trim(e->>'key') as key,
             left(trim(coalesce(e->>'section', '')), 200)   as section,
             left(trim(coalesce(e->>'sub', '')), 200)       as sub,
             left(trim(coalesce(e->>'component', '')), 200) as component,
             coalesce((e->>'show')::boolean, true)          as show,
             trim(coalesce(e->>'label', ''))                as label,
             trim(coalesce(e->>'strip', ''))                as strip,
             trim(coalesce(e->>'response', ''))             as response,
             trim(coalesce(e->>'keywords', ''))             as keywords,
             ord::int                                       as sort
        from jsonb_array_elements(p_rules) with ordinality as t(e, ord)
       order by trim(e->>'key'), ord
    ) x
  on conflict (product_id, row_key) do update
     set section = excluded.section, sub = excluded.sub, component = excluded.component, sort = excluded.sort,
         updated_by = case when (dn_map.show, dn_map.label, dn_map.strip, dn_map.response, dn_map.keywords)
                                is distinct from (excluded.show, excluded.label, excluded.strip, excluded.response, excluded.keywords)
                           then excluded.updated_by else dn_map.updated_by end,
         updated_at = case when (dn_map.show, dn_map.label, dn_map.strip, dn_map.response, dn_map.keywords)
                                is distinct from (excluded.show, excluded.label, excluded.strip, excluded.response, excluded.keywords)
                           then excluded.updated_at else dn_map.updated_at end,
         show = excluded.show, label = excluded.label, strip = excluded.strip, response = excluded.response,
         keywords = excluded.keywords, reviewed = true;
  get diagnostics v_saved = row_count;

  insert into public.dn_map_settings (product_id, show_unmapped, updated_by, updated_at)
  values (v_product, coalesce(p_show_unmapped, true), u.id, now())
  on conflict (product_id) do update
     set show_unmapped = excluded.show_unmapped, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'saved', v_saved, 'removed', v_removed);
end $$;

-- ============================================================
-- PRODUCT OPTIONS - what each factory has offered so far
--
-- A tree per product and factory: section > component > the values seen on datasheets,
-- plus special options and notes typed by editors.
--   po_values   one row per distinct value of a datasheet row, per factory and, for FCUs,
--               per unit model (FWW600VA; '' for AHUs, whose tree stays per factory). Filled by
--               po_collect after every Datasheet Notes run of any user. Only rows the
--               product's row mapping shows (dn_map.show) and that are not left out of the
--               tree (dn_map.in_tree) are taken. Project, reference, material name, report
--               date and unit tag are never stored (po__skip).
--                 times   how many units carried this value
--                 hidden  an editor took this value out of the tree
--   po_extras   special options and notes added by editors (admins and users with
--               "Can edit" for product-options), on a section or on one row of it.
--   dn_map.in_tree   false = the row is left out of the tree for every factory
--               (performance figures such as airflow that are not an option).
-- The tree only ever shows rows of the row mapping with Show ticked.
-- FCU trees are series > model > section > component (owner's rule, 2 Oct 2026): the model is
-- the Unit Model of the datasheet, the series is the model without its size figure
-- (FWW600VA, FWW400VA -> series FWWVA; po__series). The page sends the model per unit;
-- AHU units send none.
-- ============================================================

alter table public.dn_map add column if not exists in_tree boolean not null default true;

create table if not exists public.po_values (
  factory_id text not null references public.cm_factories(id) on delete cascade,
  row_key    text not null,
  model      text not null default '',
  value_key  text not null,
  value      text not null,
  times      int  not null default 1,
  hidden     boolean not null default false,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (factory_id, row_key, model, value_key)
);
-- 2 Oct 2026: the model became part of the key. Values of FCU factories saved before that carry
-- no model and cannot be placed under one, so they are removed once; running the datasheets
-- again fills the tree per model. AHU values are kept (model '').
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'po_values' and column_name = 'model') then
    alter table public.po_values add column model text not null default '';
    alter table public.po_values drop constraint po_values_pkey;
    alter table public.po_values add primary key (factory_id, row_key, model, value_key);
    delete from public.po_values v using public.cm_factories f where f.id = v.factory_id and f.product_id = 'fcu';
  end if;
end $$;

create table if not exists public.po_extras (
  id         uuid primary key default gen_random_uuid(),
  factory_id text not null references public.cm_factories(id) on delete cascade,
  section    text not null,
  row_key    text not null default '',
  kind       text not null check (kind in ('option', 'note')),
  body       text not null,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists po_extras_factory on public.po_extras (factory_id);

alter table public.po_values enable row level security;
alter table public.po_extras enable row level security;
revoke all on public.po_values, public.po_extras from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.po_values, public.po_extras from anon, authenticated;
  end if;
end $$;

insert into public.app_tools (id, category_id, name, description, path, status, sort) values
  ('product-options', 'general', 'Product Options',
   'See the sections, options and notes each factory offers, built from the datasheets run so far.',
   'tools/product-options/', 'live', 17)
on conflict (id) do nothing;
update public.app_tools set editable = true where id = 'product-options';

-- Rows that describe one project, not the product: never stored.
create or replace function public.po__skip(p_row_key text) returns boolean
language sql immutable as $$
  select p_row_key in ('general||project', 'general||reference', 'general||material name',
                       'general||selection software', 'general||report date',
                       'general||product', 'general||factory', 'general||unit');
$$;

-- The model a unit is filed under: the Unit Model without a trailing N, which marks a motor variant of
-- the same model (owner's rule, 2 Oct 2026: FWW1600TAN is FWW1600TA, FWW600VAN is FWW600VA). The
-- variant still shows inside the model as a value of the Unit Model row, and its other differences
-- as further values of the rows concerned.
create or replace function public.po__model(p_model text) returns text
language sql immutable as $$
  select regexp_replace(left(regexp_replace(trim(coalesce(p_model, '')), '\s+', ' ', 'g'), 60), 'N$', '', 'i');
$$;

-- The series of a unit model: the model without its size figure (FWW600VA -> FWWVA, FWW700VA-D -> FWWVA-D).
create or replace function public.po__series(p_model text) returns text
language sql immutable as $$
  select regexp_replace(public.po__model(p_model), '\d+', '', 'g');
$$;

-- Values filed under a variant model before the rule above are moved to their model (merged with
-- what is there; nothing to do once the script has run).
insert into public.po_values (factory_id, row_key, model, value_key, value, times, hidden, first_at, last_at)
select v.factory_id, v.row_key, public.po__model(v.model), v.value_key, min(v.value), sum(v.times)::int, bool_or(v.hidden), min(v.first_at), max(v.last_at)
  from public.po_values v
 where v.model <> public.po__model(v.model)
 group by v.factory_id, v.row_key, public.po__model(v.model), v.value_key
on conflict (factory_id, row_key, model, value_key) do update
   set times = po_values.times + excluded.times, last_at = greatest(po_values.last_at, excluded.last_at);
delete from public.po_values v where v.model <> public.po__model(v.model);

-- A value as it is kept: spacing tidied, and the quantity in front of an option line removed
-- ("2 x Inspection window" and "1 x Inspection window" are one option).
create or replace function public.po__value(p_row_key text, p_value text) returns text
language sql immutable as $$
  select left(trim(case when p_row_key like '%|options|option'
                        then regexp_replace(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'), '^\s*\d+\s*x\s+', '', 'i')
                        else regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g') end), 300);
$$;

-- Called by Datasheet Notes after every datasheet, for any approved user.
--   p_items: [{ "factory": "Riyadh", "key": "unit data||panel", "value": "62 mm", "model": "" }, ...]
--            one item per unit and row. The factory is the name read from the datasheet;
--            model is the unit model for FCUs (tree per model) and empty for AHUs.
-- Items whose factory is not a factory of the product, whose row is not shown by the row
-- mapping, or that are left out of the tree, are ignored. At most 300 different values are
-- kept per row and factory.
create or replace function public.po_collect(p_token text, p_product_id text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_product text; v_n int := 0;
begin
  perform public.app__session_user(p_token);
  v_product := public.dn__product(p_product_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    perform public.app__fail('The values could not be read.');
  end if;
  if jsonb_array_length(p_items) > 20000 then
    perform public.app__fail('Too many values to save in one go (more than 20000).');
  end if;

  insert into public.po_values (factory_id, row_key, model, value_key, value, times)
  select x.factory_id, x.row_key, x.model, x.value_key, min(x.value), count(*)::int
    from (
      select f.id as factory_id, m.row_key,
             public.po__model(e->>'model') as model,
             public.po__value(m.row_key, e->>'value') as value,
             lower(public.po__value(m.row_key, e->>'value')) as value_key
        from jsonb_array_elements(p_items) e
        join public.cm_factories f on f.product_id = v_product and f.active
                                  and lower(f.name) = lower(trim(coalesce(e->>'factory', '')))
        join public.dn_map m on m.product_id = v_product and m.row_key = trim(coalesce(e->>'key', ''))
                            and m.show and m.in_tree
       where not public.po__skip(m.row_key)
    ) x
   where x.value_key not in ('', '-')
     and (exists (select 1 from public.po_values v
                   where v.factory_id = x.factory_id and v.row_key = x.row_key and v.model = x.model and v.value_key = x.value_key)
          or (select count(*) from public.po_values v
               where v.factory_id = x.factory_id and v.row_key = x.row_key and v.model = x.model) < 300)
   group by x.factory_id, x.row_key, x.model, x.value_key
  on conflict (factory_id, row_key, model, value_key) do update
     set times = po_values.times + excluded.times, last_at = now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'saved', v_n);
end $$;

-- The tree of one factory. Any approved user.
-- Rows: only rows of the row mapping with Show ticked that have a value or an editor's entry
-- for this factory. Editors also get the rows and values taken out of the tree (marked hidden)
-- and the list of section names, so they can bring a row back or add to any section.
-- Every value carries its model ('' for AHUs); 'models' lists the models seen with their series
-- and how many units each had, so the page can draw series > model groups.
create or replace function public.po_get_tree(p_token text, p_factory_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users; f public.cm_factories; v_edit boolean;
begin
  u := public.app__session_user(p_token);
  f := public.cm__factory(p_factory_id);
  v_edit := public.app__can_edit(u, 'product-options');
  return jsonb_build_object(
    'factory', jsonb_build_object('id', f.id, 'name', f.name, 'product_id', f.product_id,
                 'product', (select p.name from public.cm_products p where p.id = f.product_id)),
    'can_edit', v_edit,
    'updated', (select max(v.last_at) from public.po_values v where v.factory_id = f.id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('key', m.row_key, 'section', m.section, 'sub', m.sub,
               'component', case when m.label <> '' then m.label else m.component end,
               'hidden', not m.in_tree,
               'values', coalesce((
                 select jsonb_agg(jsonb_build_object('k', v.value_key, 'v', v.value, 'n', v.times, 'hidden', v.hidden, 'model', v.model)
                                  order by v.model, v.times desc, v.value_key)
                   from public.po_values v
                  where v.factory_id = f.id and v.row_key = m.row_key and (v_edit or not v.hidden)), '[]'::jsonb))
             order by m.sort, m.row_key)
        from public.dn_map m
       where m.product_id = f.product_id and m.show and not public.po__skip(m.row_key)
         and (v_edit or m.in_tree)
         and (exists (select 1 from public.po_values v
                       where v.factory_id = f.id and v.row_key = m.row_key and (v_edit or not v.hidden))
              or exists (select 1 from public.po_extras x where x.factory_id = f.id and x.row_key = m.row_key))
      ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('model', t.model, 'series', public.po__series(t.model), 'units', t.units)
                       order by public.po__series(t.model), t.units desc, t.model)
        from (select v.model, max(n) as units
                from (select v.model, v.row_key, sum(v.times) as n from public.po_values v
                       where v.factory_id = f.id and v.model <> '' group by v.model, v.row_key) v
               group by v.model) t), '[]'::jsonb),
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'section', x.section, 'key', x.row_key, 'kind', x.kind,
               'body', x.body, 'at', x.updated_at,
               'by', (select w.full_name from public.app_users w where w.id = coalesce(x.updated_by, x.created_by)))
             order by x.created_at, x.id)
        from public.po_extras x where x.factory_id = f.id), '[]'::jsonb),
    'sections', case when v_edit then coalesce((
      select jsonb_agg(s.section order by s.sort)
        from (select m.section, min(m.sort) as sort from public.dn_map m
               where m.product_id = f.product_id and m.show and m.section <> '' and lower(m.section) <> 'general'
               group by m.section) s), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Add (p_id null) or change a special option or a note. Editors of product-options.
--   p_section: section name; p_row_key: '' = for the whole section, or the key of one row.
create or replace function public.po_admin_save_extra(
  p_token text, p_factory_id text, p_id uuid, p_section text, p_row_key text, p_kind text, p_body text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users; f public.cm_factories; v_id uuid;
  v_section text := trim(regexp_replace(coalesce(p_section, ''), '\s+', ' ', 'g'));
  v_body    text := trim(coalesce(p_body, ''));
begin
  u := public.app__require_editor(p_token, 'product-options');
  f := public.cm__factory(p_factory_id);
  if p_kind is null or p_kind not in ('option', 'note') then perform public.app__fail('Choose special option or note.'); end if;
  if length(v_section) not between 1 and 120 then perform public.app__fail('Give the section a name of up to 120 characters.'); end if;
  if length(v_body) = 0 then perform public.app__fail('Type the text first.'); end if;
  if length(v_body) > 1000 then perform public.app__fail('The text is longer than 1000 characters.'); end if;

  if p_id is null then
    insert into public.po_extras (factory_id, section, row_key, kind, body, created_by, updated_by)
    values (f.id, v_section, trim(coalesce(p_row_key, '')), p_kind, v_body, u.id, u.id)
    returning id into v_id;
  else
    update public.po_extras set kind = p_kind, body = v_body, updated_by = u.id, updated_at = now()
     where id = p_id and factory_id = f.id
    returning id into v_id;
    if v_id is null then perform public.app__fail('That entry no longer exists. Refresh the page.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.po_admin_delete_extra(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__require_editor(p_token, 'product-options');
  delete from public.po_extras where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Take a value or a whole row out of the tree, or bring it back. Editors of product-options.
--   p_value_key '' = the whole row, for every factory of the product (dn_map.in_tree);
--   otherwise that one value for this factory (and model, '' for AHUs).
drop function if exists public.po_admin_set_hidden(text, text, text, text, boolean);
create or replace function public.po_admin_set_hidden(
  p_token text, p_factory_id text, p_row_key text, p_value_key text, p_hidden boolean, p_model text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.cm_factories; v_n int;
begin
  perform public.app__require_editor(p_token, 'product-options');
  f := public.cm__factory(p_factory_id);
  if coalesce(p_value_key, '') = '' then
    update public.dn_map set in_tree = not coalesce(p_hidden, false)
     where product_id = f.product_id and row_key = p_row_key;
  else
    update public.po_values set hidden = coalesce(p_hidden, false)
     where factory_id = f.id and row_key = p_row_key and model = coalesce(p_model, '') and value_key = p_value_key;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then perform public.app__fail('That row no longer exists. Refresh the page.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- PROJECTS
--
-- A project is the folder every piece of work is saved under: the specification conversions
-- of the Compliance Maker (cm_runs.project_id), the answers a user filled for them
-- (cm_run_lines.compliance / remarks) and the tables of the Datasheet Notes (pr_notes).
--   pr_lists      the choices for Client type and Region (super user edits them here in SQL)
--   pr_projects   one row per project: name, client type, client name, region, who and when
--   pr_notes      one saved Datasheet Notes table per run, as shown to the user
--   pr_log        what happened in a project, by whom (history / audit)
-- Who sees what: a user sees and works in the projects he created; admins and the super user
-- see every project. Who approves what: a user's compliance answer goes into the master
-- library (cm_lines) only when an editor of the Compliance Maker approves it (admins, the
-- super user, and users given "Can edit" for it). Datasheet notes stay in their project.
-- ============================================================

create table if not exists public.pr_lists (
  kind  text not null check (kind in ('client_type', 'region')),
  value text not null,
  sort  int  not null default 100,
  primary key (kind, value)
);

create table if not exists public.pr_projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client_type text not null,
  client_name text not null,
  region      text not null,
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.app_users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists pr_projects_owner_idx on public.pr_projects (created_by, created_at desc);

create table if not exists public.pr_notes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pr_projects(id) on delete cascade,
  user_id    uuid references public.app_users(id) on delete set null,
  product_id text not null references public.cm_products(id),
  file_names text not null default '',
  units      int  not null default 0,
  row_count  int  not null default 0,
  columns    jsonb not null default '[]'::jsonb,   -- unit tags, one per column
  rows       jsonb not null default '[]'::jsonb,   -- [{ section, component, cells, marks, kind }] as on screen
  created_at timestamptz not null default now()
);
create index if not exists pr_notes_project_idx on public.pr_notes (project_id, created_at desc);

-- People a project is shared with. A member works in the project like its creator
-- (add, fill, read, download); only the creator or an admin deletes it or changes who it is shared with.
create table if not exists public.pr_members (
  project_id uuid not null references public.pr_projects(id) on delete cascade,
  user_id    uuid not null references public.app_users(id) on delete cascade,
  added_by   uuid references public.app_users(id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table public.pr_members enable row level security;
create index if not exists pr_members_user_idx on public.pr_members (user_id);

create table if not exists public.pr_log (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.pr_projects(id) on delete cascade,
  user_id    uuid references public.app_users(id) on delete set null,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pr_log_project_idx on public.pr_log (project_id, created_at desc);

-- Compliance Maker conversions belong to a project; a user's own answers sit on the run's lines.
--   review: ''         no answer, or the answer is the one the library already holds
--           'pending'  waiting for an editor   'approved' now in the library   'rejected' kept in the project only
alter table public.cm_runs      add column if not exists project_id uuid references public.pr_projects(id) on delete set null;
alter table public.cm_run_lines add column if not exists compliance  text not null default '';
alter table public.cm_run_lines add column if not exists remarks     text not null default '';
alter table public.cm_run_lines add column if not exists answered_by uuid references public.app_users(id) on delete set null;
alter table public.cm_run_lines add column if not exists answered_at timestamptz;
alter table public.cm_run_lines add column if not exists review      text not null default '';
alter table public.cm_run_lines add column if not exists reviewed_by uuid references public.app_users(id) on delete set null;
alter table public.cm_run_lines add column if not exists reviewed_at timestamptz;
create index if not exists cm_runs_project_idx on public.cm_runs (project_id, created_at desc);
create index if not exists cm_run_lines_review_idx on public.cm_run_lines (review) where review = 'pending';

alter table public.pr_lists    enable row level security;
alter table public.pr_projects enable row level security;
alter table public.pr_notes    enable row level security;
alter table public.pr_log      enable row level security;
revoke all on public.pr_lists, public.pr_projects, public.pr_notes, public.pr_log from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.pr_lists, public.pr_projects, public.pr_notes, public.pr_log from anon, authenticated;
  end if;
end $$;

insert into public.pr_lists (kind, value, sort) values
  ('client_type', 'Consultant', 10), ('client_type', 'Contractor', 20), ('client_type', 'Developer / Owner', 30),
  ('client_type', 'Distributor / Dealer', 40), ('client_type', 'Government', 50), ('client_type', 'Other', 90),
  ('region', 'UAE', 10), ('region', 'Saudi Arabia', 20), ('region', 'Qatar', 30), ('region', 'Kuwait', 40),
  ('region', 'Bahrain', 50), ('region', 'Oman', 60), ('region', 'Egypt', 70), ('region', 'Other Middle East', 80),
  ('region', 'Africa', 85), ('region', 'Other', 90)
on conflict (kind, value) do nothing;

insert into public.app_tools (id, category_id, name, description, path, status, sort) values
  ('projects', 'general', 'Projects',
   'Open a project to convert specifications and read datasheets. Everything is saved under it.',
   'tools/projects/', 'live', 5)
on conflict (id) do nothing;
-- Tools opened from the Projects page instead of their team tile.
update public.app_tools set project_tool = true where id in ('compliance-maker', 'datasheet-notes', 'product-options');

-- ---------- helpers ----------
-- "Admin" for projects = the super user, or the admin of the tile the Projects tool sits on.
create or replace function public.pr__is_admin(u public.app_users) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select u.role = 'superuser'
      or exists (select 1 from public.app_category_admins a join public.app_tools t on t.category_id = a.category_id
                  where a.user_id = u.id and t.id = 'projects');
$$;

-- The project, if this user may open it (its creator, someone it is shared with, an admin or the super user). Raises otherwise.
create or replace function public.pr__project(u public.app_users, p_id uuid)
returns public.pr_projects
language plpgsql security definer set search_path = public, extensions as $$
declare p public.pr_projects;
begin
  select * into p from public.pr_projects where id = p_id;
  if p.id is null or not (public.pr__is_admin(u) or p.created_by = u.id
       or exists (select 1 from public.pr_members m where m.project_id = p.id and m.user_id = u.id)) then
    perform public.app__fail('That project is not available. Choose a project first.');
  end if;
  return p;
end $$;

-- Who may share a project: an admin or the super user (any project), and the project's creator
-- when he has "Can edit" for at least one tool (a key user). Other users cannot share.
create or replace function public.pr__can_share(u public.app_users, p public.pr_projects) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.pr__is_admin(u)
      or (p.created_by = u.id and exists (select 1 from public.app_tool_editors e where e.user_id = u.id));
$$;

create or replace function public.pr__log(p_project uuid, p_user uuid, p_action text, p_detail text default '')
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.pr_log (project_id, user_id, action, detail)
  values (p_project, p_user, p_action, left(coalesce(p_detail, ''), 400));
$$;

create or replace function public.pr__name(p_user uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select full_name from public.app_users where id = p_user), '(deleted user)');
$$;

-- ---------- user API ----------
create or replace function public.pr_options(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.app__session_user(p_token);
  return jsonb_build_object(
    'client_types', coalesce((select jsonb_agg(value order by sort, value) from public.pr_lists where kind = 'client_type'), '[]'::jsonb),
    'regions',      coalesce((select jsonb_agg(value order by sort, value) from public.pr_lists where kind = 'region'), '[]'::jsonb));
end $$;

-- The projects this user may open (admins: all), newest activity first, with what each holds.
create or replace function public.pr_list(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  u := public.app__session_user(p_token);
  return jsonb_build_object('all', public.pr__is_admin(u), 'projects', coalesce((
    select jsonb_agg(x.j order by x.last_at desc) from (
      select greatest(p.updated_at,
                      coalesce((select max(r.created_at) from public.cm_runs r where r.project_id = p.id), p.created_at),
                      coalesce((select max(n.created_at) from public.pr_notes n where n.project_id = p.id), p.created_at)) as last_at,
             jsonb_build_object('id', p.id, 'name', p.name, 'client_type', p.client_type, 'client_name', p.client_name,
               'region', p.region, 'created_at', p.created_at, 'created_by', public.pr__name(p.created_by),
               'mine', p.created_by = u.id,
               'shared_with_me', exists (select 1 from public.pr_members m where m.project_id = p.id and m.user_id = u.id),
               'members', (select count(*) from public.pr_members m where m.project_id = p.id),
               'compliance', (select count(*) from public.cm_runs r where r.project_id = p.id),
               'notes', (select count(*) from public.pr_notes n where n.project_id = p.id),
               'pending', (select count(*) from public.cm_run_lines rl join public.cm_runs r on r.id = rl.run_id
                            where r.project_id = p.id and rl.review = 'pending'),
               'last_at', greatest(p.updated_at,
                      coalesce((select max(r.created_at) from public.cm_runs r where r.project_id = p.id), p.created_at),
                      coalesce((select max(n.created_at) from public.pr_notes n where n.project_id = p.id), p.created_at))) as j
        from public.pr_projects p
       where public.pr__is_admin(u) or p.created_by = u.id
          or exists (select 1 from public.pr_members m where m.project_id = p.id and m.user_id = u.id)
    ) x), '[]'::jsonb));
end $$;

-- Create (p_id null) or change a project. All four fields are required.
create or replace function public.pr_save(
  p_token text, p_id uuid, p_name text, p_client_type text, p_client_name text, p_region text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users; p public.pr_projects;
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 120);
  v_client text := left(regexp_replace(trim(coalesce(p_client_name, '')), '\s+', ' ', 'g'), 120);
  v_type text := trim(coalesce(p_client_type, '')); v_region text := trim(coalesce(p_region, ''));
begin
  u := public.app__session_user(p_token);
  if length(v_name) < 2 then perform public.app__fail('Project name is required.'); end if;
  if not exists (select 1 from public.pr_lists where kind = 'client_type' and value = v_type) then
    perform public.app__fail('Choose the client type.'); end if;
  if length(v_client) < 2 then perform public.app__fail('Client name is required.'); end if;
  if not exists (select 1 from public.pr_lists where kind = 'region' and value = v_region) then
    perform public.app__fail('Choose the region.'); end if;

  if p_id is null then
    if exists (select 1 from public.pr_projects x where x.created_by = u.id and lower(x.name) = lower(v_name)) then
      perform public.app__fail('You already have a project with this name. Open it from the list, or use another name.');
    end if;
    insert into public.pr_projects (name, client_type, client_name, region, created_by, updated_by)
    values (v_name, v_type, v_client, v_region, u.id, u.id) returning * into p;
    perform public.pr__log(p.id, u.id, 'Project created', v_name);
  else
    p := public.pr__project(u, p_id);
    update public.pr_projects set name = v_name, client_type = v_type, client_name = v_client, region = v_region,
           updated_by = u.id, updated_at = now() where id = p.id;
    perform public.pr__log(p.id, u.id, 'Project details changed',
      case when p.name <> v_name then 'Name: ' || p.name || ' -> ' || v_name else '' end);
  end if;
  return jsonb_build_object('ok', true, 'id', p.id);
end $$;

-- One project: its details, what is saved in it, and its history.
create or replace function public.pr_get(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; p public.pr_projects;
begin
  u := public.app__session_user(p_token);
  p := public.pr__project(u, p_id);
  return jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'name', p.name, 'client_type', p.client_type, 'client_name', p.client_name,
       'region', p.region, 'created_at', p.created_at, 'created_by', public.pr__name(p.created_by),
       'updated_at', p.updated_at, 'updated_by', public.pr__name(p.updated_by)),
    -- what this person may do here, and who the project is shared with
    'access', jsonb_build_object('owner', p.created_by = u.id, 'can_share', public.pr__can_share(u, p),
                'can_delete', (p.created_by = u.id or public.pr__is_admin(u)),
                'members', coalesce((select jsonb_agg(au.full_name order by au.full_name) from public.pr_members m
                                       join public.app_users au on au.id = m.user_id where m.project_id = p.id), '[]'::jsonb)),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'user', public.pr__name(r.user_id),
               'product_id', r.product_id, 'product', pd.name, 'factory', fa.name, 'source', r.source, 'file_name', r.file_name,
               'lines', r.line_count, 'from_library', r.matched_count,
               -- progress: clauses that can be answered, and those that show an answer now (the project's own or the library's)
               'clauses', (select count(*) from public.cm_run_lines rl where rl.run_id = r.id and rl.line_id is not null),
               'filled', (select count(*) from public.cm_run_lines rl left join public.cm_lines l on l.id = rl.line_id
                           where rl.run_id = r.id and rl.line_id is not null
                             and (rl.compliance <> '' or rl.remarks <> '' or l.status = 'answered')),
               'answered', (select count(*) from public.cm_run_lines rl where rl.run_id = r.id and (rl.compliance <> '' or rl.remarks <> '')),
               'pending',  (select count(*) from public.cm_run_lines rl where rl.run_id = r.id and rl.review = 'pending'),
               'approved', (select count(*) from public.cm_run_lines rl where rl.run_id = r.id and rl.review = 'approved'),
               'rejected', (select count(*) from public.cm_run_lines rl where rl.run_id = r.id and rl.review = 'rejected'))
             order by r.created_at desc)
        from public.cm_runs r
        join public.cm_products pd on pd.id = r.product_id
        join public.cm_factories fa on fa.id = r.factory_id
       where r.project_id = p.id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'created_at', n.created_at, 'user', public.pr__name(n.user_id),
               'product_id', n.product_id, 'product', pd.name, 'file_names', n.file_names, 'units', n.units, 'rows', n.row_count)
             order by n.created_at desc)
        from public.pr_notes n join public.cm_products pd on pd.id = n.product_id
       where n.project_id = p.id), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(x.j order by x.id desc) from (
        select g.id, jsonb_build_object('at', g.created_at, 'user', public.pr__name(g.user_id), 'action', g.action, 'detail', g.detail) as j
          from public.pr_log g where g.project_id = p.id order by g.id desc limit 200) x), '[]'::jsonb));
end $$;

-- Save one Datasheet Notes table in a project (called by the tool after every read).
create or replace function public.pr_note_save(
  p_token text, p_project_id uuid, p_product_id text, p_file_names text, p_columns jsonb, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; p public.pr_projects; v_id uuid; v_units int; v_rows int;
begin
  u := public.app__session_user(p_token);
  p := public.pr__project(u, p_project_id);
  perform public.dn__product(p_product_id);
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    perform public.app__fail('There is no table to save.');
  end if;
  if length(p_rows::text) > 12000000 then
    perform public.app__fail('This table is too large to keep in the project. Download the Excel instead.');
  end if;
  v_units := jsonb_array_length(p_columns);
  v_rows := (select count(*) from jsonb_array_elements(p_rows) e where coalesce(e->>'kind', 'row') = 'row');
  insert into public.pr_notes (project_id, user_id, product_id, file_names, units, row_count, columns, rows)
  values (p.id, u.id, p_product_id, left(coalesce(p_file_names, ''), 400), v_units, v_rows, p_columns, p_rows)
  returning id into v_id;
  perform public.pr__log(p.id, u.id, 'Datasheet notes saved',
    v_units || (case when v_units = 1 then ' unit' else ' units' end) || ', ' || left(coalesce(p_file_names, ''), 200));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- One saved Datasheet Notes table, to show or download it again.
create or replace function public.pr_note_get(p_token text, p_note_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; n public.pr_notes;
begin
  u := public.app__session_user(p_token);
  select * into n from public.pr_notes where id = p_note_id;
  if n.id is null then perform public.app__fail('That table no longer exists.'); end if;
  perform public.pr__project(u, n.project_id);
  return jsonb_build_object('id', n.id, 'file_names', n.file_names, 'columns', n.columns, 'rows', n.rows,
    'created_at', n.created_at, 'user', public.pr__name(n.user_id), 'project_id', n.project_id,
    'project', (select name from public.pr_projects where id = n.project_id),
    'product', (select name from public.cm_products where id = n.product_id));
end $$;

-- Remove one saved record from a project: p_kind 'run' (a conversion and the answers on it) or 'note'.
-- Clauses and approved answers already in the master library stay there.
create or replace function public.pr_delete_record(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; v_project uuid; v_what text;
begin
  u := public.app__session_user(p_token);
  if p_kind = 'note' then
    select project_id, file_names into v_project, v_what from public.pr_notes where id = p_id;
    if v_project is null then perform public.app__fail('That record no longer exists.'); end if;
    perform public.pr__project(u, v_project);
    delete from public.pr_notes where id = p_id;
    perform public.pr__log(v_project, u.id, 'Datasheet notes deleted', v_what);
  elsif p_kind = 'run' then
    select project_id, file_name into v_project, v_what from public.cm_runs where id = p_id;
    if v_project is null then perform public.app__fail('That record no longer exists.'); end if;
    perform public.pr__project(u, v_project);
    -- the conversion leaves the project; it stays in the library's conversion history
    update public.cm_run_lines set review = '' where run_id = p_id and review = 'pending';
    update public.cm_runs set project_id = null where id = p_id;
    perform public.pr__log(v_project, u.id, 'Compliance record removed', v_what);
  else
    perform public.app__fail('Unknown record type.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Delete a whole project (its creator, or an admin). Its datasheet tables and history go with
-- it. Its conversions leave the project but stay in the library and its conversion history,
-- as when one record is removed; answers still waiting for review are withdrawn.
create or replace function public.pr_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; p public.pr_projects;
begin
  u := public.app__session_user(p_token);
  p := public.pr__project(u, p_id);
  if not (p.created_by = u.id or public.pr__is_admin(u)) then
    perform public.app__fail('Only the person who created this project, or an admin, can delete it.');
  end if;
  update public.cm_run_lines rl set review = ''
    from public.cm_runs r where r.id = rl.run_id and r.project_id = p.id and rl.review = 'pending';
  update public.cm_runs set project_id = null where project_id = p.id;
  delete from public.pr_projects where id = p.id;       -- pr_notes and pr_log go with it
  return jsonb_build_object('ok', true);
end $$;

-- Sharing: who the project is shared with, and the people it can be shared with.
create or replace function public.pr_share_get(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; p public.pr_projects; v_can boolean;
begin
  u := public.app__session_user(p_token);
  p := public.pr__project(u, p_id);
  v_can := public.pr__can_share(u, p);
  return jsonb_build_object('can_share', v_can, 'owner', public.pr__name(p.created_by),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'name', au.full_name, 'username', au.username,
                                    'added_by', public.pr__name(m.added_by), 'at', m.added_at) order by au.full_name)
                           from public.pr_members m join public.app_users au on au.id = m.user_id where m.project_id = p.id), '[]'::jsonb),
    -- approved people other than the creator; only sent to someone who may share
    'users', case when v_can then coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'name', au.full_name, 'username', au.username,
                                    'team', au.team_note) order by au.full_name)
                           from public.app_users au where au.status = 'approved' and au.id <> p.created_by), '[]'::jsonb)
                  else '[]'::jsonb end);
end $$;

-- Set who the project is shared with (the whole list). Admins, or the creator when he is a key user.
create or replace function public.pr_share_set(p_token text, p_id uuid, p_user_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; p public.pr_projects; v_ids uuid[]; v_added text; v_removed text;
begin
  u := public.app__session_user(p_token);
  p := public.pr__project(u, p_id);
  if not public.pr__can_share(u, p) then
    perform public.app__fail('Sharing a project needs an admin, or the project''s creator with edit rights.');
  end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 200 then perform public.app__fail('A project can be shared with at most 200 people.'); end if;
  select coalesce(array_agg(au.id), '{}'::uuid[]) into v_ids from public.app_users au
   where au.id = any(coalesce(p_user_ids, '{}'::uuid[])) and au.status = 'approved' and au.id <> p.created_by;
  select string_agg(au.full_name, ', ' order by au.full_name) into v_removed
    from public.pr_members m join public.app_users au on au.id = m.user_id
   where m.project_id = p.id and not (m.user_id = any(v_ids));
  select string_agg(au.full_name, ', ' order by au.full_name) into v_added
    from public.app_users au where au.id = any(v_ids)
     and not exists (select 1 from public.pr_members m where m.project_id = p.id and m.user_id = au.id);
  delete from public.pr_members m where m.project_id = p.id and not (m.user_id = any(v_ids));
  insert into public.pr_members (project_id, user_id, added_by)
  select p.id, x, u.id from unnest(v_ids) x on conflict do nothing;
  if v_added is not null then perform public.pr__log(p.id, u.id, 'Shared with', v_added); end if;
  if v_removed is not null then perform public.pr__log(p.id, u.id, 'Sharing ended for', v_removed); end if;
  return jsonb_build_object('ok', true, 'members', coalesce(array_length(v_ids, 1), 0));
end $$;

-- A user's filled compliance for one conversion of his project.
--   p_rows: [{ "spec", "compliance", "remarks" }, ...] read from the filled Excel
-- Each answer is stored on the matching line of the conversion (same text rule as the library).
-- An answer equal to what the library already holds needs no review; any other waits for an editor.
create or replace function public.pr_submit_answers(p_token text, p_run_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users; r public.cm_runs; v_total int; v_stored int; v_pending int;
begin
  u := public.app__session_user(p_token);
  select * into r from public.cm_runs where id = p_run_id;
  if r.id is null or r.project_id is null then perform public.app__fail('That compliance record is not in a project.'); end if;
  perform public.pr__project(u, r.project_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.app__fail('No rows were found in that file.');
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 20000 then perform public.app__fail('That file has more than 20000 rows.'); end if;

  with src as (
    select distinct on (public.cm__norm(e.val->>'spec'))
           public.cm__norm(e.val->>'spec') as norm,
           left(trim(coalesce(e.val->>'compliance', '')), 200) as c,
           left(trim(coalesce(e.val->>'remarks', '')), 4000)   as rm
      from jsonb_array_elements(p_rows) with ordinality as e(val, ord)
     where trim(coalesce(e.val->>'compliance', '')) <> '' or trim(coalesce(e.val->>'remarks', '')) <> ''
     order by public.cm__norm(e.val->>'spec'), e.ord desc
  ), up as (
    update public.cm_run_lines rl
       set compliance = s.c, remarks = s.rm, answered_by = u.id, answered_at = now(),
           review = case when l.status = 'answered' and l.compliance = s.c and l.remarks = s.rm then '' else 'pending' end,
           reviewed_by = null, reviewed_at = null
      from src s, public.cm_lines l
     where rl.run_id = r.id and rl.line_id is not null and l.id = rl.line_id
       and public.cm__norm(rl.spec_text) = s.norm
       and (rl.compliance, rl.remarks) is distinct from (s.c, s.rm)
    returning rl.review
  )
  select count(*), count(*) filter (where review = 'pending') into v_stored, v_pending from up;

  perform public.pr__log(r.project_id, u.id, 'Filled compliance uploaded',
    v_stored || ' answers saved, ' || v_pending || ' sent for review (' || coalesce(nullif(r.file_name, ''), 'pasted text') || ')');
  return jsonb_build_object('ok', true, 'rows', v_total, 'stored', v_stored, 'pending', v_pending);
end $$;

-- Everything in one project, for the Excel download: details, compliance lines with the answer
-- that applies (the user's own, else the library's), datasheet tables, history.
create or replace function public.pr_export(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; p public.pr_projects; v jsonb;
begin
  u := public.app__session_user(p_token);
  p := public.pr__project(u, p_id);
  v := public.pr_get(p_token, p_id);
  perform public.pr__log(p.id, u.id, 'Project downloaded', '');
  return v || jsonb_build_object(
    'compliance', coalesce((
      select jsonb_agg(jsonb_build_object('run', rl.run_id, 'seq', rl.seq, 'type', rl.type, 'sr', rl.sr, 'spec', rl.spec_text,
               'compliance', case when rl.compliance <> '' or rl.remarks <> '' then rl.compliance else coalesce(l.compliance, '') end,
               'remarks',    case when rl.compliance <> '' or rl.remarks <> '' then rl.remarks else coalesce(l.remarks, '') end,
               'source', case when rl.compliance <> '' or rl.remarks <> '' then
                              case rl.review when 'pending' then 'Project answer, waiting for review'
                                             when 'approved' then 'Project answer, approved for the library'
                                             when 'rejected' then 'Project answer, not taken into the library'
                                             else 'Same as the library' end
                              when l.status = 'answered' then 'From the library' else '' end,
               'by', case when rl.answered_by is not null then public.pr__name(rl.answered_by) else '' end)
             order by r.created_at, rl.run_id, rl.seq)
        from public.cm_run_lines rl
        join public.cm_runs r on r.id = rl.run_id
        left join public.cm_lines l on l.id = rl.line_id
       where r.project_id = p.id), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'product', pd.name, 'file_names', n.file_names, 'created_at', n.created_at,
               'columns', n.columns, 'rows', n.rows) order by n.created_at)
        from public.pr_notes n join public.cm_products pd on pd.id = n.product_id
       where n.project_id = p.id), '[]'::jsonb));
end $$;

-- One compliance record of a project, to read and fill on the website: every row of the
-- converted specification in order, the project's own answer and the library's answer.
create or replace function public.pr_run_get(p_token text, p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users; r public.cm_runs; p public.pr_projects;
begin
  u := public.app__session_user(p_token);
  select * into r from public.cm_runs where id = p_run_id;
  if r.id is null or r.project_id is null then perform public.app__fail('That compliance record is not in a project.'); end if;
  p := public.pr__project(u, r.project_id);
  return jsonb_build_object(
    'run', jsonb_build_object('id', r.id, 'file_name', r.file_name, 'created_at', r.created_at, 'user', public.pr__name(r.user_id),
             'product', (select name from public.cm_products where id = r.product_id),
             'factory', (select name from public.cm_factories where id = r.factory_id),
             'project_id', p.id, 'project', p.name, 'client', p.client_name),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('seq', rl.seq, 'type', rl.type, 'sr', rl.sr, 'spec', rl.spec_text,
               'can', rl.line_id is not null, 'own', (rl.compliance <> '' or rl.remarks <> ''),
               'compliance', rl.compliance, 'remarks', rl.remarks, 'review', rl.review,
               'by', case when rl.answered_by is not null then public.pr__name(rl.answered_by) else '' end,
               'lib_compliance', case when l.status = 'answered' then l.compliance else '' end,
               'lib_remarks', case when l.status = 'answered' then l.remarks else '' end) order by rl.seq)
        from public.cm_run_lines rl left join public.cm_lines l on l.id = rl.line_id
       where rl.run_id = r.id), '[]'::jsonb));
end $$;

-- Save the answer typed on the website for one row of a record. Same rule as the filled Excel:
-- equal to the library answer = nothing more to do; anything else waits for review.
-- Both fields empty takes the project's own answer away (the library answer shows again).
create or replace function public.pr_run_save_line(p_token text, p_run_id uuid, p_seq int, p_compliance text, p_remarks text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users; r public.cm_runs; rl public.cm_run_lines; l public.cm_lines;
  c text := left(trim(coalesce(p_compliance, '')), 200); m text := left(trim(coalesce(p_remarks, '')), 4000);
  v_review text := '';
begin
  u := public.app__session_user(p_token);
  select * into r from public.cm_runs where id = p_run_id;
  if r.id is null or r.project_id is null then perform public.app__fail('That compliance record is not in a project.'); end if;
  perform public.pr__project(u, r.project_id);
  select * into rl from public.cm_run_lines where run_id = r.id and seq = p_seq;
  if rl.run_id is null or rl.line_id is null then perform public.app__fail('That row cannot be answered.'); end if;
  select * into l from public.cm_lines where id = rl.line_id;
  if c = '' and m = '' then
    update public.cm_run_lines set compliance = '', remarks = '', answered_by = null, answered_at = null,
           review = '', reviewed_by = null, reviewed_at = null
     where run_id = r.id and seq = p_seq;
  else
    v_review := case when l.status = 'answered' and l.compliance = c and l.remarks = m then '' else 'pending' end;
    update public.cm_run_lines set compliance = c, remarks = m, answered_by = u.id, answered_at = now(),
           review = v_review, reviewed_by = null, reviewed_at = null
     where run_id = r.id and seq = p_seq;
  end if;
  -- one history line per person, record and hour, not one per row
  if not exists (select 1 from public.pr_log g where g.project_id = r.project_id and g.user_id = u.id
                    and g.action = 'Compliance filled online' and g.detail = coalesce(nullif(r.file_name, ''), 'pasted text')
                    and g.created_at > now() - interval '1 hour') then
    perform public.pr__log(r.project_id, u.id, 'Compliance filled online', coalesce(nullif(r.file_name, ''), 'pasted text'));
  end if;
  return jsonb_build_object('ok', true, 'review', v_review);
end $$;

-- ---------- review (editors of the Compliance Maker: admins, the super user, key users) ----------

-- Answers users filled in their projects, for review. p_status: pending | approved | rejected.
create or replace function public.pr_review_list(
  p_token text, p_status text default 'pending', p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_status text := case when p_status in ('pending', 'approved', 'rejected', 'all') then p_status else 'pending' end;   -- all = every answer filled in a project
begin
  perform public.app__require_editor(p_token, 'compliance-maker');
  return jsonb_build_object(
    'counts', (select jsonb_build_object('pending', count(*) filter (where review = 'pending'),
                                         'approved', count(*) filter (where review = 'approved'),
                                         'rejected', count(*) filter (where review = 'rejected'))
                 from public.cm_run_lines where review <> '')
              || jsonb_build_object('all', (select count(*) from public.cm_run_lines rl join public.cm_runs r on r.id = rl.run_id
                                             where r.project_id is not null and (rl.compliance <> '' or rl.remarks <> ''))),
    'total', (select count(*) from public.cm_run_lines rl join public.cm_runs r on r.id = rl.run_id
               where rl.review = v_status or (v_status = 'all' and r.project_id is not null and (rl.compliance <> '' or rl.remarks <> ''))),
    'items', coalesce((
      select jsonb_agg(x.j order by x.rn) from (
        select row_number() over (order by pj.name, r.created_at, rl.seq) as rn,
               jsonb_build_object('run', rl.run_id, 'seq', rl.seq, 'sr', rl.sr, 'spec', rl.spec_text,
                 'compliance', rl.compliance, 'remarks', rl.remarks, 'review', rl.review,
                 'by', public.pr__name(rl.answered_by), 'at', rl.answered_at,
                 'project', coalesce(pj.name, '(removed from its project)'), 'client', coalesce(pj.client_name, ''),
                 'region', coalesce(pj.region, ''),
                 'product', pd.name, 'factory', fa.name, 'file_name', r.file_name,
                 'lib_compliance', coalesce(l.compliance, ''), 'lib_remarks', coalesce(l.remarks, ''),
                 'lib_answered', coalesce(l.status = 'answered', false),
                 'reviewed_by', case when rl.reviewed_by is not null then public.pr__name(rl.reviewed_by) else '' end,
                 'reviewed_at', rl.reviewed_at) as j
          from public.cm_run_lines rl
          join public.cm_runs r on r.id = rl.run_id
          join public.cm_products pd on pd.id = r.product_id
          join public.cm_factories fa on fa.id = r.factory_id
          left join public.pr_projects pj on pj.id = r.project_id
          left join public.cm_lines l on l.id = rl.line_id
         where rl.review = v_status or (v_status = 'all' and r.project_id is not null and (rl.compliance <> '' or rl.remarks <> ''))
         order by rn
         limit least(greatest(coalesce(p_limit, 100), 1), 300) offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb));
end $$;

-- Approve (the answer, as given or as corrected here, becomes the library's answer for that
-- clause and factory) or reject (it stays in the user's project only).
create or replace function public.pr_review_decide(
  p_token text, p_run_id uuid, p_seq int, p_decision text, p_compliance text default null, p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.app_users; rl public.cm_run_lines; r public.cm_runs;
  v_c text; v_r text;
begin
  a := public.app__require_editor(p_token, 'compliance-maker');
  select * into rl from public.cm_run_lines where run_id = p_run_id and seq = p_seq;
  if rl.run_id is null or rl.line_id is null or rl.review = '' then perform public.app__fail('That answer is no longer waiting for review.'); end if;
  select * into r from public.cm_runs where id = rl.run_id;
  if p_decision = 'approve' then
    v_c := left(trim(coalesce(p_compliance, rl.compliance)), 200);
    v_r := left(trim(coalesce(p_remarks, rl.remarks)), 4000);
    if v_c = '' and v_r = '' then perform public.app__fail('An approved answer cannot be empty.'); end if;
    -- a library line that already has an answer is never overwritten from a project
    if exists (select 1 from public.cm_lines l where l.id = rl.line_id and l.status = 'answered'
                  and (l.compliance, l.remarks) is distinct from (v_c, v_r)) then
      perform public.app__fail('The library already has an answer for this clause, so it was kept. Change it in the Compliance and Remarks boxes if it needs correcting.');
    end if;
    update public.cm_lines set compliance = v_c, remarks = v_r, status = 'answered',
           answered_by = a.id, answered_at = now(), answer_source = 'approved'
     where id = rl.line_id;
    insert into public.cm_answer_log (line_id, compliance, remarks, source, run_id, user_id)
    values (rl.line_id, v_c, v_r, 'approved', rl.run_id, a.id);
    -- the same answer waiting on other conversions of the same clause is settled with it
    update public.cm_run_lines x set review = 'approved', reviewed_by = a.id, reviewed_at = now()
     where x.line_id = rl.line_id and x.review = 'pending'
       and ((x.run_id = rl.run_id and x.seq = rl.seq) or (x.compliance = v_c and x.remarks = v_r));
    if r.project_id is not null then
      perform public.pr__log(r.project_id, a.id, 'Answer approved for the library', left(rl.spec_text, 200));
    end if;
  elsif p_decision = 'reject' then
    update public.cm_run_lines set review = 'rejected', reviewed_by = a.id, reviewed_at = now()
     where run_id = rl.run_id and seq = rl.seq;
    if r.project_id is not null then
      perform public.pr__log(r.project_id, a.id, 'Answer not taken into the library', left(rl.spec_text, 200));
    end if;
  else
    perform public.app__fail('Unknown decision.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- What is waiting for a decision, for the Admin page: new users, compliance answers, new mapping rows.
create or replace function public.pr_admin_summary(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.app_users;
begin
  a := public.app__require_admin(p_token);
  -- the project and library numbers are for the admins of the tile those tools sit on
  if not public.pr__is_admin(a) then
    return jsonb_build_object('pending_users', (select count(*) from public.app_users where status = 'pending'),
      'pending_answers', 0, 'new_rows', 0, 'projects', 0, 'limited', true,
      'by_region', '[]'::jsonb, 'by_client_type', '[]'::jsonb, 'by_product', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'pending_users',   (select count(*) from public.app_users where status = 'pending'),
    'pending_answers', (select count(*) from public.cm_run_lines where review = 'pending'),
    'new_rows',        (select count(*) from public.dn_map where not reviewed),
    'projects',        (select count(*) from public.pr_projects),
    'by_region', coalesce((select jsonb_agg(jsonb_build_object('name', region, 'n', n) order by n desc, region)
                             from (select region, count(*) n from public.pr_projects group by 1) x), '[]'::jsonb),
    'by_client_type', coalesce((select jsonb_agg(jsonb_build_object('name', client_type, 'n', n) order by n desc, client_type)
                             from (select client_type, count(*) n from public.pr_projects group by 1) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc, name)
                             from (select pd.name, count(distinct k.project_id) n
                                     from (select project_id, product_id from public.cm_runs where project_id is not null
                                           union all select project_id, product_id from public.pr_notes) k
                                     join public.cm_products pd on pd.id = k.product_id group by 1) x), '[]'::jsonb));
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
     where n.nspname = 'public' and (p.proname like 'app\_%' or p.proname like 'cm\_%' or p.proname like 'dn\_%' or p.proname like 'po\_%' or p.proname like 'pr\_%')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if has_anon then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
      if f.proname not like '%\_\_%' and f.proname not in ('app_bootstrap_admin', 'app_set_superuser') then
        execute format('grant execute on function %s to anon, authenticated', f.sig);
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

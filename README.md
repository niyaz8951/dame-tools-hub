# DAME Tools Hub

Internal tools website with admin-approved login (username + password, no email),
team tiles (General, Sales, SBU) and per-team access controlled by an admin.

- Front end: plain HTML/CSS/JS, hosted on GitHub Pages
- Database: Supabase (hosted PostgreSQL). GitHub Pages cannot run a database, so the pages call Supabase.
- No build step. Upload the folder as it is.

## Try it first (no database)

Open `index.html` through any local web server, or publish to GitHub Pages without
touching `config.js`. The site runs in demo mode: sign in with `admin` / `admin12345`.
Demo data lives in your browser only and is not secure. It is for looking around.

## Go live

1. **Create the database.** Make a free project at supabase.com. Open SQL Editor,
   paste the whole of `db/schema.sql`, press Run.
2. **Create your admin.** In the same SQL Editor run (with your own values):
   `select public.app_bootstrap_admin('your.username', 'Your Full Name', 'a-strong-password');`
3. **Connect the site.** In Supabase open Project Settings > API. Copy the Project URL
   and the `anon public` key into `assets/js/config.js`. Never use the `service_role` key.
4. **Publish.** Push this folder to a GitHub repository, then Settings > Pages >
   Deploy from branch > `main` / root.
5. **Check from the office PC.** Open the site and sign in. If sign-in says
   "Cannot reach the database", the office network is blocking `*.supabase.co`
   and IT will need to allow it (or the database has to move to a host they allow).

## How access works

- Anyone can fill "Request access". The request stays Pending until an admin approves it.
- On approval the admin ticks which team tiles the person can open. General is open to every approved user.
- Admin page > Tools: add a tool, choose its tile, set it Live / Coming soon / Hidden.
- Admin page > Team tiles: add more tiles later (no code change needed).

## Updating a site that is already live

1. Replace the files in the GitHub repository with this folder. `assets/js/config.js` here already contains your database settings.
2. In the Supabase SQL Editor run the whole of `db/schema.sql` again. It keeps your users, access and library, and adds anything new. If the update also came with a new dated file in `db/`, run that afterwards (`db/2026-09-30-update.sql` only needs running once).
3. Hard-refresh the browser (Ctrl+F5) so the new styles load.

## Add a new tool

1. Copy `tools/_template/` to `tools/<tool-id>/`.
2. In its `index.html` set the title, heading and `Hub.requireLogin({ tool: "<tool-id>" })`.
3. Build the tool inside the marked block using the shared classes in `assets/css/theme.css`.
4. Admin page > Tools > add the same `<tool-id>`, pick the tile, set status to Live.

Read `STANDARDS.md` before building a tool.

## What the login does and does not protect

- Passwords are bcrypt-hashed in the database. Nobody, including the admin, can read them.
- The database tables are closed to the public key. The site can only call the `app_*` functions, and each one checks the session and role.
- **Files on GitHub Pages are public.** A free GitHub Pages repo is public, and even with a private repo the published pages can be fetched by URL. The login controls what the site shows and what the database returns. It does not hide the HTML/JS of a tool from someone who knows the file address.
- So: keep anything confidential (price lists, cost factors, multipliers) in the database and load it after login, never inside a tool's HTML/JS file.

## Folder map

```
index.html            sign in / request access
dashboard.html        the tiles a user has access to, and their tools
profile.html          name, profile picture, password
admin.html            users, tools, tiles
assets/css/shell.css  Daikin colours, day/night, top bar, toast
assets/css/theme.css  shared components for native pages (imports shell.css)
assets/css/legacy-tools.css  compatibility styles for tools brought from Quicktools
assets/js/config.js   the only file with settings
assets/js/api.js      all database calls
assets/js/hub.js      session, access guard, top bar, theme toggle
assets/js/legacy-tools.js  TN.* helpers for tools brought from Quicktools
assets/js/xlsx-lite.js  small Excel reader/writer for native pages
assets/vendor/pdfjs/  pdf.js, served locally (no CDN)
data/                 shared data files (highlight rules)
tools/_template/      starting point for every tool
tools/<tool-id>/      one folder per tool
tools/compliance-maker/library.html  admin: master compliance library
db/schema.sql         database tables and functions
db/<date>-*.sql       one-off updates for a live database
```

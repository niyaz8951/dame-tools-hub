# DAME Tools Hub - build standards

Follow this for every page and tool so the site stays consistent.

## 1. Architecture (do not change without the owner's say)

- Hosting: GitHub Pages (Cloudflare does not open on office PCs). Static files only.
- Stack: vanilla HTML, CSS, JS. No framework, no build step, no CDN or web-font dependencies (office network may block them).
- Database: Supabase PostgreSQL, reached only through `app_*` functions in `db/schema.sql`. Tables stay closed to the anon key (RLS on, no policies).
- Login: username + password only. No email anywhere. New users are Pending until an admin approves.
- Access: one dashboard tile per team (category). Admin grants tiles per user. General is open to all approved users. Admins see everything.
- Modular: one folder per tool under `tools/<tool-id>/`. A tool never edits shared files to work.

## 2. Every page must

1. Load, in this order: `assets/css/theme.css`, `assets/js/config.js`, `assets/js/api.js`, `assets/js/hub.js`.
2. Have `<html lang="en" data-loading>` and `<header id="topbar"></header>` (protected pages).
3. Call the guard before doing anything:
   - `Hub.requireLogin()` any approved user
   - `Hub.requireLogin({ tool: "<tool-id>" })` tool pages
   - `Hub.requireLogin({ admin: true })` admin pages
4. Talk to the database only through `Api.*` in `api.js`. New database need = new `app_*` function in `schema.sql` + a matching `Api` method (both Supabase and demo back ends).

## 3. Theme

Daikin colours with day and night mode. Never hard-code a colour in a tool; use the variables.

| Token | Day | Night | Use |
|---|---|---|---|
| `--brand` | #0097E0 | same | Daikin blue: primary buttons, active states, icons |
| `--brand-strong` | #0078B8 | same | hover / pressed |
| `--brand-sky` | #54C3F1 | same | Daikin light blue: accents only |
| `--brand-navy` | #0B2A4A | same | toasts, deep accents |
| `--bg` | #F3F7FA | #07182A | page background |
| `--surface` | #FFFFFF | #0F263C | cards, tables, inputs |
| `--surface-2` | #EAF2F8 | #163450 | table heads, icon chips |
| `--border` | #D5E1EA | #24465F | all borders |
| `--text` / `--text-soft` | #12283A / #5A6F80 | #E6F0F7 / #9DB4C6 | text |
| `--ok` `--warn` `--danger` (+ `-bg`) | | | status only, always with a text label |

- Theme switch is the sun/moon button from `Hub.themeButton()`; choice is remembered, first visit follows the PC setting.
- Font: Segoe UI / system stack. Radius 12px cards, 8px controls.
- Use the shared classes: `page`, `page-head`, `card`, `grid`, `tile`, `btn` (`ghost`, `danger`, `sm`), `field`, `input`, `check`, `table-wrap` + `table`, `badge`, `notice`, `tabs`, `empty`.
- Do not use the Daikin logo or trademark artwork unless the owner supplies an approved file.

## 4. Tool quality bar

A tool is ready to be set Live only when:

- It works in both day and night mode and at phone width (390px) with no sideways page scroll.
- Every input is validated with a plain-language message next to the problem; nothing fails silently.
- Engineering calculations state units on every input and output, name the standard or formula used, and are checked against a known worked example before release.
- Confidential data (prices, cost factors, multipliers, customer data) is loaded from the database after login, never written inside the HTML/JS file (GitHub Pages files are public).
- All text from users or the database is written with `textContent` / `Hub.el`, never `innerHTML`.
- Loading, empty and error states exist. Buttons say what they do ("Generate statement", not "Submit").
- Large inputs (pasted specs, big tables) do not freeze the page.
- Output that people take away (Excel, PDF, copied table) opens correctly in the office tools they use.
- Wording is plain and short. No filler text.

## 5. Tool placement

| Tile | Who | Tools |
|---|---|---|
| General | every approved user | Compliance Maker (first tool), other tools useful to all teams |
| Sales | sales team | special sales tools, to be decided per requirement |
| SBU | SBU team | special SBU tools, to be decided per requirement |
| more tiles | | added later from Admin > Team tiles |

## 6. Release checklist

- [ ] Guard call uses the right tool id, and the id matches Admin > Tools
- [ ] Day + night checked, phone width checked
- [ ] No hard-coded colours, no external scripts or fonts
- [ ] No confidential data in the static files
- [ ] Tested signed out (redirects to sign in) and as a user without the tile (redirects to dashboard)
- [ ] If `schema.sql` changed: re-run it in Supabase (it is safe to re-run) and update the demo back end in `api.js`

# DAME Tools Hub - build standards

Follow this for every page and tool so the site stays consistent.

## 1. Architecture (do not change without the owner's say)

- Hosting: GitHub Pages (Cloudflare does not open on office PCs). Static files only.
- Stack: vanilla HTML, CSS, JS. No framework, no build step, no CDN or web-font dependencies (office network may block them).
- Database: Supabase PostgreSQL, reached only through `app_*` functions in `db/schema.sql`. Tables stay closed to the anon key (RLS on, no policies).
- Login: username + password only. No email anywhere. New users are Pending until an admin approves.
- One session per user: signing in ends that user's earlier session (`app_login`). The sign-in token is kept in `localStorage`, so all tabs of one browser share it and follow each other on sign-in and log out. Any `Api` call that gets `SESSION_EXPIRED` sends the user to the sign-in page with a message (handled once in `hub.js`; pages must not handle it themselves). A session lasts 12 hours.
- Access: one dashboard tile per team (category). Admins grant tiles per user. General is open to all approved users. Admins see everything.
- Roles (column `app_users.role`), enforced in the database functions, mirrored in the pages only to show or hide buttons:
  - `superuser` - exactly one account, the site owner. Everything an admin can do, plus: change roles, delete users, Admin > Tools and Admin > Team tiles. Created by `app_bootstrap_admin`, moved with `app_set_superuser('username')` in the SQL Editor, never from the website.
  - `admin` - approve / reject / disable ordinary users, set their tile access and "Can edit" tools, reset their passwords. Has write access to every editable tool by default. Cannot change roles or touch admin accounts.
  - `user` - runs the tools. May be given write access to single tools (`app_tool_editors`), shown as "Can edit" on Admin > Users.
- A tool with an edit screen (library, row mapping) is marked `app_tools.editable = true` (Admin > Tools, super user). Only editable tools appear under "Can edit". The database function behind an edit screen calls `app__require_editor(token, '<tool-id>')`; the page calls `Hub.requireLogin({ edit: "<tool-id>" })` and shows its "Manage" link with `Hub.canEdit(profile, "<tool-id>")`. Never check `role === "admin"` in a page; use `Hub.isAdmin`, `Hub.isSuper`, `Hub.canEdit`.
- Modular: one folder per tool under `tools/<tool-id>/`. A tool never edits shared files to work.

## 2. Every page must

1. Load, in this order: `assets/css/theme.css`, `assets/js/config.js`, `assets/js/api.js`, `assets/js/hub.js`. (`theme.css` imports `shell.css`, which holds the colours, top bar and toast.)
2. Have `<html lang="en" data-loading>` and `<header id="topbar"></header>` (protected pages).
3. Call the guard before doing anything:
   - `Hub.requireLogin()` any approved user
   - `Hub.requireLogin({ tool: "<tool-id>" })` tool pages
   - `Hub.requireLogin({ admin: true })` admin pages (admins and the super user)
   - `Hub.requireLogin({ super: true })` super user only
   - `Hub.requireLogin({ edit: "<tool-id>" })` a tool's edit screen (admins, and users with "Can edit" for that tool)
4. Talk to the database only through `Api.*` in `api.js`. New database need = new `app_*` function in `schema.sql` + a matching `Api` method (both Supabase and demo back ends).

## 2a. Tools brought over from Quicktools

Compliance Maker, Coil Data Extractor, Container Calculator, Centre of Gravity and Psychrometric Chart came from the Quicktools site and keep their own markup. They load a compatibility layer instead of `theme.css`:

- CSS order: `assets/css/shell.css`, `assets/css/legacy-tools.css`, then the tool's own `styles.css`.
- JS: `config.js`, `api.js`, `hub.js` in the head; `assets/js/legacy-tools.js` (gives `TN.icon`, `TN.esc`, `TN.toast`) where `global.js` used to be.
- `<header data-site-header>` becomes `<header id="topbar"></header>` followed by `<script>Hub.requireLogin({ tool: "<tool-id>" });</script>`; the old footer is removed; add `data-loading` on `<html>`.
- `legacy-tools.css` points the old `--color-*`, `--space-*`, `--font-*` tokens at the hub tokens, so these tools follow Daikin colours and day/night automatically. Never put colour values in it.
- No Google Fonts and no CDN scripts. `pdf.js` is served from `assets/vendor/pdfjs/`. Shared highlight rules are in `data/highlight-rules.json`.
- Drawings on a canvas must redraw on the `hub:theme` event.
- To bring another Quicktools tool over, repeat these steps, then add it in Admin > Tools.
- Brand new tools should be built on `theme.css` and `Hub.*`, not on this layer.

## 2b. Dashboard behaviour

- A user sees only the tiles and tools they have access to. Everything else is hidden, not shown as locked: the database does not send it (`app__profile`), and pages must not hint at tools the user cannot open.
- Tile taglines are neutral and describe the tools, never the access rule (General: "Everyday productivity tools"). No wording like "open to approved users" or "ask your admin".
- The dashboard shows one view at a time: the team tiles, or the tools of the tile that was clicked (tiles hidden, "All teams" link to go back). The address carries the team (`dashboard.html#general`) so Back and direct links work.
- Every tool page has a "General tools" style back link to its team view.
- A failed sign-in check never signs the user out unless the database says the session has expired; network problems show a "Try again" screen.

## 2c. Account features

- The top bar shows the day/night button and an account menu (profile picture or initials, first name, role for admins and the super user): Dashboard, My profile, Change password, Admin (admins and the super user), Log out. It is drawn by `hub.js` on every page, including tool pages.
- `profile.html`: change name, profile picture and password. Pictures are cropped to a 160px square JPEG in the browser and stored in `app_users.avatar` as a small data URL (the database rejects anything else or anything over 60 KB).
- Use `Hub.avatar(user, size)` wherever a person is shown.
- The site should feel pleasant to use: instant feedback on every action (toast or inline message), disabled Save until something changed, no dead ends.

## 2d. Compliance Maker and the master compliance library

Goal: collect every specification line the company meets, answer each one once, and reuse the answer. Exact matching now; the data is kept in a shape that AI can be added to later.

- The user must choose **Product** and **Factory** before upload/paste appears. Products and factories live in `cm_products` / `cm_factories` (AHU: Dubai, Riyadh. FCU: Shenzhen, Riyadh. Chiller: Italy, Jeddah).
- **Every conversion by any user is saved**: `cm_runs` (who, when, product, factory, source, counts) and `cm_run_lines` (every row in order, as converted). The PDF file is not uploaded, only the clause text.
- **Master library** `cm_lines`: one row per unique clause per factory, with Compliance, Remarks, status (open / answered), times seen, who answered and how (admin / upload). Answers never cross factories.
- A clause is the same line when its normalised text matches: lower case, punctuation and spacing ignored. Normalising happens only in the database function `cm__norm`. Do not re-implement it elsewhere (the demo back end mirrors it).
- Only body rows (letter / number / text, 8+ characters after normalising) enter the library. Headings stay with the run.
- On conversion, answered lines come back filled in the preview and the Excel (Comments: "From library (exact match)").
- Editors (admins, and users with "Can edit" for Compliance Maker) work in `tools/compliance-maker/library.html`: fill answers line by line (auto-save), upload a filled Excel (Specifications / Compliance / Remarks columns; only filled rows are taken, each clause once, a newer answer replaces the old one), download the library, see conversion history.
- Every answer ever given is kept in `cm_answer_log`. Never delete from it; it is the audit trail and the future training data.
- Users must be told on the page that conversions are saved. Never describe the tool as "nothing is uploaded".
- Later steps (not built yet, keep the door open): near-match suggestions, AI-drafted answers stored with `answer_source = 'ai'` and shown as unverified until an admin confirms. AI output must never overwrite an admin answer.

## 2e. Datasheet Notes and its row mapping

Goal: turn a product datasheet PDF into the compliance table format: Section / Component / Specs / Remarks. Admins control the rows and the wording from the website, with no code change.

- The user must choose **Product**, **Factory** and **Power supply** (380 V / 3 Ph / 60 Hz, 400 V / 3 Ph / 50 Hz, 460 V / 3 Ph / 60 Hz) before the upload appears. Products and factories come from `Api.cmOptions` (same list as the Compliance Maker). The three choices are rows of the first block ("General"); they do not change any datasheet value.
- The PDF is read in the browser with the local pdf.js. The datasheet is never uploaded or saved. Only new section and row names are saved (see row mapping below); the page tells the user so.
- Only the AHU reader exists (Daikin ASTRAWEB technical report). FCU and Chiller show "not ready yet" until sample datasheets are supplied; add a reader and switch it on in `DSParse.readers`.
- The reader gives: General, Unit Data, then every numbered section of the datasheet in order. The Options List lines are placed under their own section (Unit Options under Unit Data). Section List, Sound Report, NRVU and Electrical pages are not read.
- Labels paired with a solid dot become one row each: `Panel • Insulation` = `62 mm • Foam` gives Panel: 62 mm and Insulation: Foam. A one-word second label takes its context from the first (`Temp. Dry Bulb In • Out` gives Temp. Dry Bulb In / Temp. Dry Bulb Out). A value with dots under a single label stays as printed (`Mounting`: `Internal • Left`).
- Two filters printed in one section are shown as Filter 1 / Filter 2. Sub-headings (Damper One Supply, Geometry, Cooling, Motor Data, Options) are shaded rows, written only when one of their rows is shown.
- Remarks is always empty.

**Row mapping** (`tools/datasheet-notes/mapping.html`, admins and users with "Can edit" for Datasheet Notes, linked from the tool for them):

- Kept per factory in `dn_rules` (one row per datasheet row) and `dn_settings`. A mapping never crosses factories.
- A datasheet row is identified by its key: section name without its number | sub-heading | component, lower case (`unit data||panel`, `fan supply|motor data|efficiency class`, `filter supply||filter class`). All sections with the same name share a rule; Filter 1 / Filter 2 share a rule; all option lines of a section share one rule (`...|options|option`). Keys are made only by `DSParse.rowKey`.
- Per row the admin sets: **Show** (unticked = left out), **Name in Excel** (Component text, empty = datasheet name) and **Response**: empty = datasheet value; text = standard response; `$` or `*` in the text = where the datasheet value goes (`Panel thickness is $ Thermal break`). The rule is applied only by `DSParse.fill`.
- "Rows that are not in this list yet" (show with the datasheet value / leave out) decides what happens to a row no admin has seen. Default: show.
- **The list grows on its own.** Every datasheet any user runs sends the row names this factory's mapping has not seen (key, section, sub-heading, component; never values) to `dn_add_rows`. They are stored with `reviewed = false`, shown or left out according to the "rows not in this list yet" setting, and carry a "New" badge on the mapping screen until an admin saves. Existing rows are never changed by a user's run. Because the key uses the section name and not its number, a section that moves position keeps its mapping, and a section with a new name is added as new rows.
- The admin finds rows with "Load rows from a datasheet". Every listed row is saved, so the list is there without a datasheet next time. Rows saved earlier that are not on the loaded datasheet can be removed.
- The tool loads the mapping with `Api.dnRules` when a factory is chosen. If it cannot be loaded, every row is shown as printed and the page says so.
- Database functions: `dn_get_rules` and `dn_add_rows` (any approved user), `dn_admin_save_rules` (editors of datasheet-notes). The permissions block at the end of `schema.sql` opens `dn_*` functions to the website the same way as `app_*` and `cm_*`.
- Files: `index.html` + `datasheet-notes.js` (tool), `mapping.html` + `mapping.js` (row mapping), `ds-parse.js` (reader, keys, mapping rules), `ds-read.js` (opens the PDF), `ds-xlsx.js` (styled Excel). The Excel header colour follows the owner's compliance table format, not the site theme.

## 2f. Psychrometric Chart

Goal: plot any number of air states on an ASHRAE-style chart, join them into a process, and read properties, coil loads, SHR, apparatus dew point and bypass factor. Tool id `psychrometric-chart`, General tile, no database use (states are kept in the user's browser only, and the page says so).

- **Numbers must match ASHRAE Fundamentals Chapter 1, Table 2 and Chart No. 1.** The engine (`psychro.js`) uses the Chapter 1 equations (Hyland–Wexler saturation pressure eq. 5/6, humidity ratio eq. 20, RH eq. 24, wet bulb eq. 33/35, enthalpy eq. 30, volume eq. 26, mixing eq. 45/46) **with the water-vapour enhancement factor** (Greenspan 1976 fit of Hyland–Wexler) applied to saturation pressure everywhere. Without it the results read 0.4–0.6 % low on humidity ratio, which was the original mismatch against the printed chart. Do not remove it or add a second equation set for IP; IP figures are converted at display.
- `node test-psychro.js` checks the engine against ASHRAE Table 2 (-20 to 50 °C) and Chapter 1 Example 1. Run it after any change to `psychro.js`; humidity ratio must stay within 0.05 % of Table 2.
- Chart (`chart.js`, inline SVG): dry bulb along the bottom, humidity ratio on the right, saturation curve as the clip boundary, wet-bulb lines every 1 °C with values written on the saturation curve, enthalpy every 5 kJ/kg with the scale outside the curve, RH every 10 %, specific volume every 0.01 m³/kg, SHR protractor, pressure/altitude caption on the chart. Axis numbers and anything in the margins are drawn outside the clip. Colours only through the `--chart-*` tokens defined in `styles.css` from hub tokens.
- Multiple states are the point of the tool: rows can be added, reordered, removed, picked from the chart, or produced by "Mix two states" (mass-weighted on dry air using each row's airflow; the result is stored as an ordinary row, not a live formula).
- Worked examples must be internally consistent (a "Mixed" row equals the mix of its sources).
- State names are user text: written with `value` / `textContent` in the tables; they pass through `TN.esc` only where they enter the SVG string.

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
| General | every approved user | Compliance Maker, Datasheet Notes, Coil Data Extractor, Container Calculator, Centre of Gravity (all live), Psychrometric Chart (delivered 2026-10-01, add in Admin > Tools) |
| Sales | sales team | special sales tools, to be decided per requirement |
| SBU | SBU team | special SBU tools, to be decided per requirement |
| more tiles | | added later from Admin > Team tiles |

## 6. Release checklist

- [ ] Guard call uses the right tool id, and the id matches Admin > Tools
- [ ] Day + night checked (including canvas drawings), phone width checked
- [ ] No hard-coded colours, no external scripts or fonts
- [ ] No confidential data in the static files
- [ ] Tested signed out (redirects to sign in), as a user without the tile (redirects to dashboard), and, for an edit screen, as a user without "Can edit" (redirects to dashboard)
- [ ] If `schema.sql` changed: re-run it in Supabase (it is safe to re-run) and update the demo back end in `api.js`

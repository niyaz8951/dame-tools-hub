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

1. Load, in this order: `assets/css/theme.css`, `assets/js/config.js`, `assets/js/api.js`, `assets/js/hub.js`. (`theme.css` imports `shell.css`, which holds the colours, top bar and toast.)
2. Have `<html lang="en" data-loading>` and `<header id="topbar"></header>` (protected pages).
3. Call the guard before doing anything:
   - `Hub.requireLogin()` any approved user
   - `Hub.requireLogin({ tool: "<tool-id>" })` tool pages
   - `Hub.requireLogin({ admin: true })` admin pages
4. Talk to the database only through `Api.*` in `api.js`. New database need = new `app_*` function in `schema.sql` + a matching `Api` method (both Supabase and demo back ends).

## 2a. Tools brought over from Quicktools

Compliance Maker, Coil Data Extractor, Container Calculator and Centre of Gravity came from the Quicktools site and keep their own markup. They load a compatibility layer instead of `theme.css`:

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

- The top bar shows the day/night button and an account menu (profile picture or initials, first name): Dashboard, My profile, Change password, Admin (admins only), Log out. It is drawn by `hub.js` on every page, including tool pages.
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
- Admins work in `tools/compliance-maker/library.html`: fill answers line by line (auto-save), upload a filled Excel (Specifications / Compliance / Remarks columns; only filled rows are taken, each clause once, a newer answer replaces the old one), download the library, see conversion history.
- Every answer ever given is kept in `cm_answer_log`. Never delete from it; it is the audit trail and the future training data.
- Users must be told on the page that conversions are saved. Never describe the tool as "nothing is uploaded".
- Later steps (not built yet, keep the door open): near-match suggestions, AI-drafted answers stored with `answer_source = 'ai'` and shown as unverified until an admin confirms. AI output must never overwrite an admin answer.

## 2e. Datasheet Notes

Goal: turn a product datasheet PDF into the compliance table format: Section / Component / Specs / Remarks.

- The user must choose **Product**, **Factory** and **Power supply** (380 V / 3 Ph / 60 Hz, 400 V / 3 Ph / 50 Hz, 460 V / 3 Ph / 60 Hz) before the upload appears. Products and factories come from `Api.cmOptions` (same list as the Compliance Maker). The three choices are printed in the first block of the table ("General"); they do not change any datasheet value.
- The PDF is read in the browser with the local pdf.js. Nothing is uploaded or saved; no database table is used.
- Only the AHU reader exists (Daikin ASTRAWEB technical report). FCU and Chiller show "not ready yet" until sample datasheets are supplied; add a reader and switch it on in `READERS` in `datasheet-notes.js`.
- The table holds: General, Unit Data, then every numbered section of the datasheet in order. The Options List lines are placed under their own section (Unit Options under Unit Data). Section List, Sound Report, NRVU and Electrical pages are not included.
- **Specs only restate what the datasheet prints.** Nothing is added or assumed. Remarks is always empty.
- Labels paired with a solid dot become one row each: `Panel • Insulation` = `62 mm • Foam` gives Panel: 62 mm and Insulation: Foam. A one-word second label takes its context from the first (`Temp. Dry Bulb In • Out` gives Temp. Dry Bulb In / Temp. Dry Bulb Out). A value with dots under a single label stays as printed (`Mounting`: `Internal • Left`).
- Two filters printed in one section are shown as Filter 1 / Filter 2. Sub-headings (Damper One Supply, Geometry, Cooling, Motor Data, Options) are shaded rows.
- Files: `index.html`, `datasheet-notes.js` (page), `ds-parse.js` (reader and table rules), `ds-xlsx.js` (styled Excel). The Excel header colour follows the owner's compliance table format, not the site theme.

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
| General | every approved user | Compliance Maker, Datasheet Notes, Coil Data Extractor, Container Calculator, Centre of Gravity (all live) |
| Sales | sales team | special sales tools, to be decided per requirement |
| SBU | SBU team | special SBU tools, to be decided per requirement |
| more tiles | | added later from Admin > Team tiles |

## 6. Release checklist

- [ ] Guard call uses the right tool id, and the id matches Admin > Tools
- [ ] Day + night checked (including canvas drawings), phone width checked
- [ ] No hard-coded colours, no external scripts or fonts
- [ ] No confidential data in the static files
- [ ] Tested signed out (redirects to sign in) and as a user without the tile (redirects to dashboard)
- [ ] If `schema.sql` changed: re-run it in Supabase (it is safe to re-run) and update the demo back end in `api.js`

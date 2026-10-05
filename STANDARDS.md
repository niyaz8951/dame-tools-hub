# DAME Tools Hub - build standards

Follow this for every page and tool so the site stays consistent.

## 1. Architecture (do not change without the owner's say)

- Hosting: GitHub Pages (Cloudflare does not open on office PCs). Static files only.
- Stack: vanilla HTML, CSS, JS. No framework, no build step, no CDN or web-font dependencies (office network may block them).
- Database: Supabase PostgreSQL, reached only through the `app_*`, `cm_*`, `dn_*`, `po_*` and `pr_*` functions in `db/schema.sql` (the only SQL file, see `db/README.md`). Tables stay closed to the anon key (RLS on, no policies).
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
- A user with exactly one tile sees that tile's tools straight away (no single-tile screen, no back link). Users with several tiles are unchanged.
- Each tool tile has its own icon, picked by tool id in `dashboard.html` from `Hub.ICON` (`checklist`, `table`, `tree`, `coil`, `box`, `target`, `curve`, `book`; the document icon is the fallback). A new tool gets an icon there.
- When the guard sends a signed-in user to the dashboard for lack of access, the dashboard shows one toast: "That page is not available for your account." (set in `hub.js`). It names no tool.
- `404.html` at the repo root is the "Page not found" page for GitHub Pages. It works out the site root itself, so it works at any depth.
- **Back button** (5 Oct 2026): a solid blue "Back to <place>" button sits in the top bar beside the site name on every page that has somewhere to go back to (phone: "Back"). `hub.js` draws it. A page keeps its ordinary back link in the page head (`<p class="small"><a href="...">&larr; General</a></p>`, or `.hub-back a` on the older tools); `hub.js` moves it into the top bar and hides the paragraph. A page whose target depends on what is open calls `Hub.setBack(label, url or function)` itself (dashboard, a tool opened from a project). A page opened with `?from=admin` goes back to Admin for admins.
- A tool marked `app_tools.project_tool = true` (Compliance Maker, Datasheet Notes) is not shown on its team tile while the Projects tool is live there: it is opened from a project (section 2i).
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

## 2d-2. Structure of the compliance library (Part and topic)

- Every library line (`cm_lines`) carries the **Part** it was first seen under (`part`: 1 General, 2 Products, 3 Execution, 0 = not known) and the **section title** as written (`section`, e.g. `FANS`).
- The **topic** shown to editors is not stored. It is worked out from the section title by `cm__topic` (first match wins): Installation and testing, Submittals, Standards and quality, Filters, Humidifier, Heat recovery, Coils, Dampers and mixing, Sound and vibration, Fans and drives, Controls and electrical, Casing and base, Delivery and spares, General, Other. Improving `cm__topic` re-sorts every line at once. The demo back end mirrors it (`cmTopic` in `api.js`); change both together.
- Part and section are filled in the database by `cm__fill_structure` from `cm_run_lines` (the stored rows of each conversion): the nearest `PART n` row and the nearest section row above the clause. It runs for each conversion inside `cm_save_run`, and once for all stored conversions when `schema.sql` is run. A value already set is never changed (first seen wins). Contents lines (dot leaders) and false sections starting with `0.` are ignored. The page sends nothing extra.
- Matching is unchanged: a clause is still the same line when its normalised text matches. Part and topic are for browsing and for the later clause-to-datasheet-row link; they are not part of the key.
- **The library reads like a converted specification** (owner's rule, 2 Oct 2026). Each line also keeps where it was first seen: the conversion (`home_run`), its position there (`home_seq`), its own label (`sr`: A, 1, a), its row type and the number of its section (`section_sr`: 1.07). All filled by `cm__fill_structure`.
- Reading order, decided only by `cm__library_order` (demo mirror: `cmLibraryOrder`): Part 1, 2, 3; then sections by title, so every "QUALITY CONTROL" of every specification sits together (groups ordered by their lowest section number); inside a title one block per specification, oldest first, each with its own number ("1.07 QUALITY CONTROL", then "1.05 QUALITY CONTROL" from another file); then the clauses in the order of that specification. A clause already in the library stays in the block where it was first seen.
- Library screen: black PART row, blue section row (number, title, topic, source file), Sr column with the clause label, the same word highlights as the Compliance Maker (`cm-highlight.js`, a copy of its default rules: keep both in step), then Compliance and Remarks to fill. Filters stay: To answer / Answered / All lines, Part, Topic, search. 100 lines per page. Colours come from the theme tokens.
- Library download (`xlsxWriter.buildLibrary`): Part / Topic / Section / Sr / Specifications / Compliance / Remarks / Source file, with the black and blue rows, coloured Sr and red highlights of a converted file, frozen header and filter. The upload still finds Specifications / Compliance / Remarks by heading, so a downloaded file can be filled and uploaded back (tested).
- Contents lines are no longer added to the library as clauses.

## 2e. Datasheet Notes and its row mapping

Goal: turn a product datasheet PDF into the compliance table format: Section / Component / one column per unit tag / Remarks. Admins control the rows and the wording from the website, with no code change.

- The user chooses the **Product** only; the upload appears once its row mapping has loaded. Products come from `Api.cmOptions`. There is no factory dropdown and no power supply dropdown: whatever the table shows comes from the datasheet. The **Factory** row is the first row of the table: for an AHU from the last character of the Material Name (owner's rule: `...9` = Riyadh, `...5` = Dubai, e.g. `ADN10FGW9`; `FACTORY` in `ds-parse.js`), for an FCU from the Software Name (`McQuay Smart Tools` = Shenzhen). Anything else leaves the row out and the page says so.
- **Power Supply** is read from the datasheet: the Electrical Connection printed for `Fan Supply` in "Electrical Power Inputs Data" (for example `400V/3Ph/50Hz + PE`), as printed. If there is no Fan Supply line the first line starting with "Fan" is used; if there is none the row is missing and the page says so.
- **Several units.** One PDF can hold several units (an AHU unit starts on the page with the "Unit Data" heading, an FCU unit on the page with the report title; `DSParse.parseAll` picks the reader with `DSParse.detect`), and several PDFs can be chosen at once. Every unit gets its own column headed by its unit tag (the "Unit" line of an AHU datasheet, the "Unit No." of an FCU datasheet; repeated tags get "(2)", "(3)"). Remarks is the last column. There is no "Unit" row, the tag is the column heading. A long schedule is fine: the Kifaf FCU PDF (1375 units, one per page, 26 MB) reads in about 6 s; the page shows "Reading … page n of N" while it works, the title names the first 12 units, and the Excel gets one column per unit. PDFs up to 60 MB are accepted.
- **The datasheet must match the chosen product** (`DSRead.check`): an FCU datasheet run as AHU is refused with a message naming the product to choose, on the tool and on the mapping screen, so rows never land under the wrong product's mapping.
- With one unit the Section column shows the datasheet heading (`2) Filter Supply`). With several units section numbers differ per unit, so rows are lined up by section name (a 2nd section of the same name is `Filter Supply (2)`), sub-heading and component; option lines are lined up by their text. A unit that does not have a row gets `-`. A row only a later unit has is placed after the row that comes before it in that unit. Only `DSParse.grid` builds the table.
- The PDF is read in the browser with the local pdf.js. The PDF itself is never uploaded. Saved are: the table made from it, in the chosen project (section 2i), new section and row names (row mapping below) and the values of the shown rows for the Product Options tree (section 2g; never the project, reference or unit tag). The page tells the user so.
- Readers: AHU (Daikin ASTRAWEB technical report, in `ds-parse.js`) and FCU (Daikin FAN COIL UNIT TECHNICAL REPORT from McQuay Smart Tools, in `ds-fcu.js`, built 2 Oct 2026 on the owner's Kifaf Phase-5 schedule). Chiller shows "not ready yet" until a sample datasheet is supplied; a reader registers itself in `DSParse.readers` with `starts(page)` and `parse(pages)` and is then picked up by the tool, the mapping screen and the product check.
- The reader gives: General (product, power supply, project, reference, material name, software, report date), Unit Data, then every numbered section of the datasheet in order. The Options List lines are placed under their own section (Unit Options under Unit Data). Section List, Sound Report and NRVU pages are not read; from the Electrical page only the Fan Supply connection is used.
- Labels paired with a solid dot become one row each: `Panel • Insulation` = `62 mm • Foam` gives Panel: 62 mm and Insulation: Foam. A one-word second label takes its context from the first (`Temp. Dry Bulb In • Out` gives Temp. Dry Bulb In / Temp. Dry Bulb Out). A value with dots under a single label stays as printed (`Mounting`: `Internal • Left`).
- **Differences between units.** The first unit is the reference. In every row, a cell whose text differs from the first unit's is highlighted: yellow for the first different value, then one colour per further different value (5 colours, then they repeat); equal values in a row share a colour; `-` (row missing in that unit) counts as a value. Compared after the row mapping, ignoring case and spacing (`DSParse.grid` gives `marks` per row). On screen the colours are built from the theme tokens (`--warn-bg`, `--ok-bg`, `--danger-bg`, mixes of `--brand`) and each coloured cell has a "Differs from <first unit>" tooltip; the Excel uses fixed fills (`DIFF_FILLS` in `ds-xlsx.js`). "Only rows that differ" filters the preview only; the Excel always has every row.
- Two filters printed in one section are shown as Filter 1 / Filter 2. Sub-headings (Damper One Supply, Geometry, Cooling, Motor Data, Options) are shaded rows, written only when one of their rows is shown.
- **FCU reader** (`ds-fcu.js`). One page = one unit. The title block gives Project, Unit No. (column heading), Software Name + version (Selection Software) and Selection date (Report Date); two fields may share a line, so lines are cut at the field names. Headings are the bold lines alone at the left margin (bold = a font other than the page's most common one): General, Configuration information, Cooling coil (Cooling Mode), Cooling coil (Heating Mode), Electric Heater, Acoustical performance, or Sound pressure level (dB(A)) on the DC-motor layout. The rows under "General" are the **Unit Data** block; the other headings are sections without numbers (Section column shows the name as printed). Rows are printed in two columns (label | value | label | value): a label starts in a label column (left margin, or the most common start between 40 % and 60 % of the page width) and its value in the value column (the most common other start of its half), so a long label that ends a few points before its value is still split ("Shipping Dimension W*H*D (mm)" / "1841*558*250") and a split label is joined ("Running current" + "(A)"). Rows are listed column by column within a block (left column, then right), as the datasheet groups related figures by column. A label with nothing after it is a row with an empty value (the Heating Mode and Electric Heater blocks when not used). Superscripts (the tiny "3" of m³, "2" of m²) are put back into the label (`superscripts` in `ds-parse.js`, shared by all readers: only 1-2 digit tiny items raised above a line). **Power Supply** = the "Power Source" row of General, moved to the General group (not repeated under Unit Data). **Acoustic table:** the "Octave Band" row names the bands; every row under it (Lw Inlet + Rad(dB(A)), Lw Outlet Duct(dB(A)), Sound pressure level, High / Medium / Low speed) becomes a sub-heading with one row per band (63Hz … Overall), values matched to the nearest band by position; a unit printed after the last value ("dB(A)") stays with it. The "Note" lines at the foot of the page end the unit and are not read. **Factory** from the Software Name in the title block (owner's rule, 2 Oct 2026): `McQuay Smart Tools` = Shenzhen (`FACTORY` in `ds-fcu.js`); other software names are added there when the owner gives them. An unknown name leaves the Factory row out, the page says so, and those units are not collected for Product Options. Three layouts seen on the Kifaf schedule (AC 3-speed with Eurovent badge, AC with AHRI badge and a single sound-pressure row, DC 0-10V with three speed rows) all read: 1375 units, 116 distinct rows, every printed value found.
- Remarks is always empty.

**Row mapping** (`tools/datasheet-notes/mapping.html`, admins and users with "Can edit" for Datasheet Notes, linked from the tool for them):

- Kept per **product** in `dn_map` (one row per datasheet row) and `dn_map_settings`: one mapping for all factories (owner's decision, 1 Oct 2026). The first version was per factory in `dn_rules` / `dn_settings`; `schema.sql` copies those into `dn_map` once and they are no longer read or written.
- A datasheet row is identified by its key: section name without its number | sub-heading | component, lower case (`unit data||panel`, `fan supply|motor data|efficiency class`, `filter supply||filter class`). All sections with the same name share a rule; Filter 1 / Filter 2 share a rule; all option lines of a section share one rule (`...|options|option`). Keys are made only by `DSParse.rowKey`.
- Per row the admin sets: **Show** (unticked = left out), **Name in Excel** (Component text, empty = datasheet name), **Spec keywords** (see 2e-2), **Remove text** (text taken out of the datasheet value first: `+ PE` turns `380V/3Ph/60Hz + PE` into `380V/3Ph/60Hz`; several texts separated by `;`, case ignored) and **Response**: empty = datasheet value; text = standard response; `$` or `*` in the text = where the datasheet value goes (`Panel thickness is $ Thermal break`). The rule is applied only by `DSParse.fill`.
- "Rows that are not in this list yet" (show with the datasheet value / leave out) decides what happens to a row no admin has seen. Default: show.
- **The list grows on its own.** Every datasheet any user runs sends the row names this product's mapping has not seen (key, section, sub-heading, component; never values) to `dn_add_rows`. They are stored with `reviewed = false`, shown or left out according to the "rows not in this list yet" setting, and carry a "New" badge on the mapping screen until an admin saves. Existing rows are never changed by a user's run. Because the key uses the section name and not its number, a section that moves position keeps its mapping, and a section with a new name is added as new rows.
- The admin finds rows with "Load rows from a datasheet". Every listed row is saved, so the list is there without a datasheet next time. Rows saved earlier that are not on the loaded datasheet can be removed.
- The tool loads the mapping with `Api.dnRules` when the product is chosen. If it cannot be loaded, every row is shown as printed and the page says so.
- Database functions: `dn_get_rules` and `dn_add_rows` (any approved user), `dn_admin_save_rules` (editors of datasheet-notes). The permissions block at the end of `schema.sql` opens `dn_*` functions to the website the same way as `app_*` and `cm_*`.
- Files: `index.html` + `datasheet-notes.js` (tool), `mapping.html` + `mapping.js` (row mapping), `ds-parse.js` (AHU reader, lines, keys, mapping rules, grid), `ds-fcu.js` (FCU reader), `ds-read.js` (opens the PDFs, returns the units, product check, progress), `ds-xlsx.js` (styled Excel; landscape and first two columns frozen when there are several units). Both HTML pages load `ds-parse.js`, then `ds-fcu.js`, then `ds-read.js`.
- Notices under the table are grouped: one line per distinct point, naming the units it concerns (no names when it concerns every unit). Values for Product Options are sent in parts of at most 20000 (`po_collect`'s limit). The Excel header colour follows the owner's compliance table format, not the site theme.

## 2e-2. Compliance Maker "Datasheet rows" sheet (spec to datasheet rows, no AI)

Goal: after a specification is converted, show the same Section / Component rows as the Datasheet Notes table with the specification clause for each, so spec and datasheet meet in one table. Owner's decision (1 Oct 2026): no AI for now.

- Every row of the product's mapping (`dn_map`) has **Spec keywords** (`keywords`, edited on the Row mapping screen). Entries are separated by `;`. An entry matches a clause when every word of it starts a word of the clause or of the heading the clause sits under (`fin spac` finds "fins shall be spaced"; `inside casing` finds the items under the heading "Inside Casing"). Section titles (`2.02 CASING`) are not used as context. Words found in the clause must stand within 6 other words of each other; numbers are not counted.
- Parts: Part 2 (Products) is searched first; Part 1 only for a row Part 2 has nothing for; Part 3 (Execution) never. A spec with no parts is searched whole. Table-of-contents lines are ignored.
- Per row: up to 3 clauses, best first; clauses scoring under half of the best are dropped; "(+ N more clauses)" is written when there are more. Cell text is `clause number: clause sentence`. Nothing found = empty. The tool never judges Comply / Deviation.
- Rows: every mapping row with Show ticked, in mapping order, with its Name in Excel. Rows without keywords are listed and stay empty.
- Output: a second panel on the Compliance Maker page ("Only rows found in the specification" filters the preview) and a second sheet "Datasheet rows" in the same Excel (Section / Component / Specification requirement / Remarks, all rows).
- `schema.sql` seeds starter keywords for AHU once (only while no AHU row has keywords).
- Only `CMRows.match` / `CMRows.clauses` in `tools/compliance-maker/cm-rows.js` do the matching. `xlsx-writer.js` takes the sheet as `meta.sheet2`.
- Spec reader fixes made with this (in `compliance-maker.js`): a wrapped line starting with a decimal (`0.68 W/m2 ...`, `1.52 mm ...`) is no longer taken as a section; running page headers and footers of a PDF (same text at the top or bottom of at least 3 pages and 40% of pages) are removed and the count is shown in the status line.
- **Cover and contents are skipped** (option "Skip the cover and contents pages", on by default, PDF and pasted text; `skipFrontMatter` in `compliance-maker.js`). Lines are dropped from the top only: up to the first real `PART 1` heading (one that is not a contents entry ending in dot leaders and a page number), or, when there is no PART 1, up to the last contents entry of a table of contents in the first third of the document. The status line says how many lines were skipped. Nothing after that point is removed.
- Benchmark for AHU: the owner's "SECTION 15720 Air Handling Units Rev 0" (35 pages, Parts 1-3). With the starter keywords: 540 rows (49 cover and contents lines skipped), 24 datasheet rows found.
- Next steps agreed (not built): link a library clause to a datasheet row (confirmed match), `$` in library Remarks, datasheet upload inside the Compliance Maker for spec vs unit columns.

## 2f. Psychrometric Chart

Goal: plot any number of air states on an ASHRAE-style chart, join them into a process, and read properties, coil loads, SHR, apparatus dew point and bypass factor. Tool id `psychrometric-chart`, General tile, no database use (states are kept in the user's browser only, and the page says so).

- **Numbers must match ASHRAE Fundamentals Chapter 1, Table 2 and Chart No. 1.** The engine (`psychro.js`) uses the Chapter 1 equations (Hyland–Wexler saturation pressure eq. 5/6, humidity ratio eq. 20, RH eq. 24, wet bulb eq. 33/35, enthalpy eq. 30, volume eq. 26, mixing eq. 45/46) **with the water-vapour enhancement factor** (Greenspan 1976 fit of Hyland–Wexler) applied to saturation pressure everywhere. Without it the results read 0.4–0.6 % low on humidity ratio, which was the original mismatch against the printed chart. Do not remove it or add a second equation set for IP; IP figures are converted at display.
- `node test-psychro.js` checks the engine against ASHRAE Table 2 (-20 to 50 °C) and Chapter 1 Example 1. Run it after any change to `psychro.js`; humidity ratio must stay within 0.05 % of Table 2.
- Chart (`chart.js`, inline SVG): dry bulb along the bottom, humidity ratio on the right, saturation curve as the clip boundary, wet-bulb lines every 1 °C with values written on the saturation curve, enthalpy every 5 kJ/kg with the scale outside the curve, RH every 10 %, specific volume every 0.01 m³/kg, SHR protractor, pressure/altitude caption on the chart. Axis numbers and anything in the margins are drawn outside the clip. Colours only through the `--chart-*` tokens defined in `styles.css` from hub tokens.
- Multiple states are the point of the tool: rows can be added, reordered, removed, picked from the chart, or produced by "Mix two states" (mass-weighted on dry air using each row's airflow; the result is stored as an ordinary row, not a live formula).
- Worked examples must be internally consistent (a "Mixed" row equals the mix of its sources). A mixed row remembers its two sources: the step into it is shown as "Mixing" with no coil load. Fan heat, reheat and heating steps keep the humidity ratio. SHR shows "—" when the total load is close to zero.
- IP mode switches the whole tool: chart axes and captions (°F, gr/lb, Btu/lb, in.Hg, ft) with round IP ticks, airflow in cfm, messages, CSV and PNG. The engine stays SI.
- Anything that changes the pressure (altitude, measured pressure) redraws the chart, the properties and the loads together.
- States are kept per user in the browser (`dame.psychro.v1:<username>`).
- State names are user text: written with `value` / `textContent` in the tables; they pass through `TN.esc` only where they enter the SVG string.

## 2g. Product Options (tree of what each factory offers)

Goal: one place to see, per product and factory, the sections, components and the options given so far, plus what the team knows beyond the datasheets. Tool id `product-options`, General tile (sort 17, after Datasheet Notes), editable. Built 2 Oct 2026.

- The user chooses **Product** and **Factory** (`Api.cmOptions`). The tree is Product > Section > (sub-heading) > Component > values for AHUs.
- **FCU trees are per model** (owner's rule, 2 Oct 2026): Series > Model > Section > Component > the values that model's units had. The model is the datasheet's Unit Model row (`unit data||unit model`, sent by Datasheet Notes as `model` on every value of the unit; `MODEL_ROW` in `datasheet-notes.js`) **without a trailing N**, which marks a motor variant of the same model (`po__model`, owner's rule 2 Oct 2026: FWW1600TAN is filed under FWW1600TA, FWW600VAN under FWW600VA; the variant shows as a value of the Unit Model row inside the model and its other differences as further values); the series is the model without its size figure (`po__series`: FWW600VA, FWW400VA = series FWWVA; FWW700VA-D = FWWVA-D). Values filed under a variant before the rule are merged into their model when `schema.sql` runs. `po_values` keeps the model in its key (`model`, '' for AHUs); `po_get_tree` returns `models` (model, series, units) and the model on every value; the page groups (`drawSections` per model, models closed until opened). Special options and notes are per section or row for every model and are drawn once under "All models". Values taken out are per factory, row and model (`po_admin_set_hidden` `p_model`). The Excel gets Series and Model columns first. AHU trees are unchanged (no models).
- **Only mapped rows.** The tree shows rows of the Datasheet Notes row mapping (`dn_map`) with Show ticked, and only those that have a value or an editor's entry for the chosen factory. A row unticked in the mapping leaves the tree at once. The database decides this (`po_get_tree`); the page only draws.
- **It grows with every datasheet run.** After each Datasheet Notes run of any user, the page sends the values of the shown rows of every unit (`po_collect`), with the unit's factory as read from the datasheet (Material Name ending). Stored in `po_values`: one row per distinct value per row and factory, with how many units had it (`times`). The value is as printed, after the row's "Remove text", never the standard response. Option lines lose their quantity (`2 x Inspection window` = `Inspection window`). At most 300 different values per row and factory.
- **Never stored:** project, reference, material name, selection software, report date, product, factory, unit tag (`po__skip`; the page does not send them either). Power Supply is kept. A unit whose factory is not known is not collected.
- **Editors** (admins, and users with "Can edit" for Product Options) use the Edit switch on the same page:
  - add / change / delete a **special option** or a **note** on a section or on one row (`po_extras`, per factory; shows who and when), and on a section that is not in the tree yet or a new section name;
  - **take out a value** (per factory, `po_values.hidden`) or **leave out a row** (`dn_map.in_tree = false`, for every factory of the product; such a row is no longer collected). Both can be brought back. Use it for figures that are not options (airflow, pressure drop).
- Users never receive hidden rows or values. Rows with more than 8 values show the 8 most seen and "+ N more"; when every value is a number with one unit, the lowest and highest are shown as a range first.
- Search filters sections, components, values, special options and notes. Download Excel gives Section / Sub-section / Component / Options seen on datasheets / Special options / Notes (what a user sees).
- The page must say that a value not listed is not known yet, not that the factory cannot offer it.
- Database: `po_collect`, `po_get_tree` (any approved user), `po_admin_save_extra`, `po_admin_delete_extra`, `po_admin_set_hidden` (editors of `product-options`). The permissions block opens `po_*` like `app_*`, `cm_*`, `dn_*`. Demo mirror in `api.js` (`poSkip`, `poValue`; change both together).
- Files: `tools/product-options/index.html`, `product-options.js`; the hook is `collect()` in `tools/datasheet-notes/datasheet-notes.js`.

## 2h. Rules added by the user walk-through (2 Oct 2026)

Found by testing every tool as an ordinary user; list and status in the project doc `UI-Test-Findings-2026-10-02.md`.

- **Excel text is cleaned.** Anything written into an .xlsx passes a cleaner that drops characters XML does not allow (control characters, lone surrogates). Compliance Maker: `clean()` in `xlsx-writer.js`.
- **Preview and download always agree.** A setting changed after a run updates the preview at once (Compliance Maker formatting ticks) or clears the result (Datasheet Notes product change, Coil Data Extractor file list). Where the result is out of date and cannot be refreshed without a run, the downloads are disabled and the page says why (Container Calculator).
- **A failed run clears the previous result.**
- **Cut input is said clearly.** Compliance Maker: PDF 50 pages, paste 150,000 characters cut at a whole line; a warning notice above the preview and a "PARTIAL" line in the Excel band and last row.
- **Several files:** every error names its file; one bad file does not discard the good ones (Datasheet Notes shows the good units and lists the files not read).
- **No leave-page prompts** in tools. Light state (product, factory, pasted text) is kept across a reload in `sessionStorage`.
- **Work kept in the browser is per user**: storage keys end in `:<username>` (Centre of Gravity `tn.cog.v1:<username>`, Psychrometric Chart). Opening a file validates its shape before replacing anything. Replacing a non-empty list or project asks first.
- **Stored values stay in base units** (mm, kg, m³/h); unit switches convert only for display, so a round trip returns the same figures. Centre of Gravity project files are version 2 (mm and kg, display unit recorded); version 1 files still open.
- **CSV output**: UTF-8 marker, units in every heading, rounded figures; a text cell starting with `=`, `+`, `-` or `@` gets a leading apostrophe; numbers stay numbers.
- **Container Calculator.** Clearance is the gap kept between items, not to the walls; an item that fits the vehicle is never refused for clearance. Piece list, PDF and packing list show sizes as entered; positions include the clearance, and the page and PDF say so. Limit 5,000 pieces per calculation. Freight cost is empty by default with a free-text currency. "Download cargo list" gives a file the importer reads back unchanged. CSV import detects `;` and decimal commas. The PDF prints Latin text only (`[non-Latin text]` marker; the page warns; Excel keeps the text). The 45–55 % centre of gravity band is described as a rule of thumb. **Palletised cargo stays upright** (owner's rule, 2 Oct 2026): with "Cargo is palletised" ticked, "Allow turning on side" is switched off and greyed, for pallets and loose items alike (`packOptions()` in `app.js`). An item larger than every ticked pallet goes on a **made-to-size skid** (ticked by default in the pallet list: deck = the item's footprint, 150 mm high, about 20 kg per m², safe working load 2000 kg; estimates in line with the China skid presets, and the page says so), stacked up to the max load height, so it is drawn with a base like any pallet. With "Made-to-size skid" unticked such rows are packed loose and a notice in the results names them. Drawing colours follow the cargo row (`srcRow`), so they match the legend when rows are palletised.
- **Datasheet Notes.** Section and Component columns stay in view when the table scrolls sideways. Excel: fit to one page wide up to 6 unit columns, above that full size with columns A:B repeated; a legend line under the table. Difference colours repeat after 5 values and the page says so without naming a colour. FCU title block: a field name inside a line counts only when followed by a colon (or "Unit No." with its full stop). Cancel while reading.
- **Row mapping.** New rows collected from users' runs do not count as unsaved changes; Save confirms them.
- **Product Options.** Counts read "seen n times" (a datasheet run twice counts twice). A product or factory that no reader can supply says so instead of pointing to Datasheet Notes. Excel is styled by `po-xlsx.js`. An editor with Edit off sees exactly what users see.
- **Standards** (tool id `standards`, General tile, added by the owner). `Std.scan` accepts "Standard", "Std", "Guideline" and ANSI/…, BS EN ISO, ISO/IEC prefixes; a number that is not in the library is listed as "not in the library", never mapped to a neighbour; the bare word "Eurovent" is assigned by nearby product wording or listed as not in the library. `node test-standards.js` must pass after any change to `std.js` or the keys in `standards-data.js`.
- **Compliance Maker keyword rule is unchanged** (an entry word may be the start of a clause word, so `pre` also finds `pressure`); editors tighten the keyword.
- **Passwords** cannot be only spaces (`app__check_password`).
- **Admin > Users**: a row's Save is enabled only when the row differs from the stored values.

## 2i. Projects (project history and data, built 5 Oct 2026)

Goal: everything a user makes is saved against a project, can be found again, downloaded as one Excel, and seen by admins across all users. Tool id `projects`, General tile, first tile (sort 5). Files in `tools/projects/`.

- **Project** (`pr_projects`): Project name, Client type, Client name, Region. All four are mandatory (checked in `pr_save`). Client types and regions are lists in `pr_lists`, seeded in `schema.sql` (change them there). One user cannot have two projects with the same name.
- **Who sees a project:** its creator; admins and the super user see every project of every user (`pr__project`). Nobody else, not even a key user. Sharing a project between users is not built.
- **Pages:** `index.html` (Add New Project, Project history with search and filters; admins also get creator, a summary by region / client type / product and a download of the list), `project.html?id=` (details, tool tiles, compliance records, datasheet notes, history, Download project), `record.html?run=` (one converted specification, read and filled online), `note.html?id=` (one saved datasheet table, view only), `review.html` (compliance review, editors of Compliance Maker). The Projects page carries the buttons **Compliance review** (editors) and **Product Options** (everyone who has that tool); Product Options has no tile of its own (`project_tool`) and goes back to Projects (`?from=projects`).
- **Tool tiles on the project page:** blue when the project holds data from the tool, grey when it holds none. Both open the tool (`../<tool>/index.html?project=<id>`). A user only gets tiles for tools he has.
- **A project tool** (`app_tools.project_tool`) puts a Project select on its page and calls `PRPick.attach({ select, hint, profile, onChange })` (`tools/projects/pr-pick.js`). Nothing can be converted or read until a project is chosen; the Back button leads to the project. The choice follows `?project=` and is remembered for the tab. If the Projects tool is not live for the account, `PRPick.required()` is false and the tool works without a project, as before. A new tool that produces user output must do the same and save its output in a `pr_*` table.
- **Compliance records:** `cm_runs.project_id` (set by `cm_save_run(..., p_project_id)`). The project page groups them by product. A record is shown by its file name without the extension ("AHU Specs"); clicking it opens `record.html`: the specification as converted (black PART rows, blue section rows, Sr labels, highlights) with Compliance and Remarks boxes that save on leaving the box (`pr_run_get`, `pr_run_save_line`). A green box is the library answer; changing it makes a project answer; emptying both boxes goes back to the library answer. The spec text itself is not editable (it is the key to the library). The page downloads the styled compliance Excel (`xlsxWriter.build`, project name in the header). The user can also fill the Excel and upload it on the record ("Upload filled Excel", `pr_submit_answers`). Either way answers are stored on the record's lines (`cm_run_lines.compliance / remarks / answered_by`). An answer equal to the library answer needs nothing more; a new or different one gets `review = 'pending'`.
- **Review** (`review.html`, `pr_review_list`, `pr_review_decide`): admins, the super user and users with "Can edit" for Compliance Maker. Every card names who filled the answer; filters by person and project; tab "All filled" lists every answer of every project with its state. Admins can open the record from a card (only the creator and admins can open a project's record). Approve (wording may be corrected first) writes the answer to the master library (`cm_lines`, `answer_source = 'approved'`, logged in `cm_answer_log`) for every user; "Do not take" leaves it in the project only. A user's answer never reaches the library without this step.
- **Datasheet notes:** every Datasheet Notes read saves its table (columns, rows, difference marks) in `pr_notes`, at most 12 MB per table; the page says when a table is too large. They stay in the project and never enter the compliance library. The project page shows the table online (`note.html`, with the difference colours, search, "Only rows that differ") and gives the same Excel again (`DSXlsx.build`).
- **Product options** stay one company-wide tree (section 2g), opened from the Projects page.
- **Download project (Excel)** (`pr_export`, `pr-xlsx.js`): sheets **Project Information**, then per product **Specs-<Product>** (every converted specification of that product, one under the other: Sr / Specifications / Compliance / Remarks / Answer from / Filled by, PART rows black, section rows blue) and **Notes-<Product>** (every datasheet table of that product). No Product Options or History sheet (owner's rule, 5 Oct 2026); history stays on the project page.
- **History** (`pr_log`): created, details changed, specification converted, filled compliance uploaded, datasheet notes saved, record removed, answer approved / not taken, project downloaded; each with who and when. Never deleted.
- Removing a compliance record takes it out of the project (the clauses stay in the library); removing a datasheet table deletes it.
- **Admin page:** tabs Users, Compliance Library (Review and approval, Master compliance library), Products (Product row mapping, Product options), Projects (numbers and a link to all projects), Who approves what, Tools and Team tiles (super user). A "Waiting for a decision" line at the top counts users to approve, answers to review and new datasheet rows to map (`pr_admin_summary`).
- Database: tables `pr_lists`, `pr_projects`, `pr_notes`, `pr_log`; functions `pr_options`, `pr_list`, `pr_save`, `pr_get`, `pr_export`, `pr_note_save`, `pr_note_get`, `pr_run_get`, `pr_run_save_line`, `pr_delete_record`, `pr_submit_answers` (any approved user, own projects), `pr_review_list`, `pr_review_decide` (Compliance Maker editors), `pr_admin_summary` (admins). Demo mirror in `api.js` (storage key `dame_hub_demo_db_v9`).
- **Database folder:** `db/schema.sql` is the only SQL file; no dated one-off files. `db/README.md` says how to run it, the order of its parts and who may do what.

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
| General | every approved user | Projects (which opens Compliance Maker and Datasheet Notes), Product Options, Coil Data Extractor, Container Calculator, Centre of Gravity, Psychrometric Chart, Standards (all live, all in the seed of `schema.sql` and the demo seed in `api.js`) |
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

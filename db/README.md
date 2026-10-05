# Database

There is one file to run: `schema.sql`.

## When to run it
- First set-up of the Supabase project.
- After every site update that says "re-run `db/schema.sql`".

## How
1. Supabase > SQL Editor > New query.
2. Paste the whole of `schema.sql` and press Run.
3. "Success. No rows returned" means it is done.

It is safe to run again at any time. It never deletes users, access rights,
library lines, row mappings, product options or projects. It only adds what is
missing and replaces the functions with the current ones.

## What is in it, in order
| Part | Tables | Functions |
|---|---|---|
| Users, sessions, tiles, tools | `app_*` | `app_*` |
| Compliance Maker library | `cm_*` | `cm_*` |
| Datasheet Notes row mapping | `dn_*` | `dn_*` |
| Product Options | `po_*` | `po_*` |
| Projects, review, history | `pr_*` | `pr_*` |
| Permissions (last) | | closes every table, opens only the public functions |

The order matters: a later part uses the tables of the earlier ones. A new
tool adds its part above "Permissions".

## Rules
- The site reaches the database only through the functions. Every table has
  Row Level Security on and no policies, so the public key cannot read one.
- A function with two underscores (`app__...`, `pr__...`) is internal and is
  not open to the site.
- No dated or one-off SQL files. A change goes into `schema.sql` in a form that
  can be re-run (`create table if not exists`, `add column if not exists`,
  `create or replace function`).

## Who may do what (checked in the database)
| Action | Super user | Admin | Key user ("Can edit" for the tool) | User |
|---|---|---|---|---|
| Approve, reject, disable a user; tile access; "Can edit" | yes | yes (users only) | | |
| Make or change an admin, delete an account | yes | | | |
| Add or change tools and team tiles | yes | | | |
| Approve a project answer into the compliance library | yes | yes | yes (Compliance Maker) | |
| Edit the compliance library directly | yes | yes | yes (Compliance Maker) | |
| Datasheet row mapping | yes | yes | yes (Datasheet Notes) | |
| Remove product option values | yes | yes | yes (Product Options) | |
| See every user's projects | yes | yes | | |
| Create projects, save and download own project data | yes | yes | yes | yes |
| Share a project with other users | yes (any project) | yes (any project) | yes (projects he created) | |
| Work in a project shared with him | yes | yes | yes | yes |

The super user is set once, in the SQL Editor: `select public.app_set_superuser('<username>');`

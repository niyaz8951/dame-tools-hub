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
"Admin" is per tile: the super user makes a person admin of single tiles (Admin > Users).
An admin's powers below apply on his own tiles only.

| Action | Super user | Admin of the tile | Key user ("Can edit" for the tool) | User |
|---|---|---|---|---|
| Make someone admin of a tile, change or reset an admin, delete an account | yes | | | |
| Add or change tools and team tiles | yes | | | |
| Approve, reject, disable an ordinary user; reset his password | yes | yes | | |
| Give an ordinary user access to a tile, or "Can edit" for a tool on it | yes | yes (his tiles) | | |
| Edit the data of a tool (compliance library, row mapping, product options) | yes | yes (tools on his tiles) | yes (that tool) | |
| Take a project answer into the compliance library | yes | yes (General) | yes (Compliance Maker) | |
| See every user's projects | yes | yes (General) | | |
| Share a project with other users | yes (any) | yes (General: any) | yes (projects he created) | |
| Create projects, work in own and shared projects | yes | yes | yes | yes |

The super user is set once, in the SQL Editor: `select public.app_set_superuser('<username>');`

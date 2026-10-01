-- DAME Tools Hub: adds the Datasheet Notes tool to the General tile.
-- Run once in the Supabase SQL Editor. Safe to run again.
-- (Same as adding it by hand in Admin > Tools with id datasheet-notes.)

insert into public.app_tools (id, category_id, name, description, path, status, sort) values
  ('datasheet-notes', 'general', 'Datasheet Notes',
   'Turn a product datasheet PDF into an Excel table of unit data, sections and options.',
   'tools/datasheet-notes/', 'live', 15)
on conflict (id) do update
   set category_id = excluded.category_id, name = excluded.name, description = excluded.description,
       path = excluded.path, status = excluded.status, sort = excluded.sort;

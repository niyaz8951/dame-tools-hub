-- DAME Tools Hub: data update for a database that is already live.
-- Run AFTER re-running db/schema.sql. Run once in the Supabase SQL Editor. Safe to run again.

-- 1. Put the four General tools live.
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
   'tools/centre-of-gravity/', 'live', 40)
on conflict (id) do update
   set category_id = excluded.category_id, name = excluded.name, description = excluded.description,
       path = excluded.path, status = excluded.status, sort = excluded.sort;

-- 2. Neutral tile taglines.
update public.app_categories set description = 'Everyday productivity tools'            where id = 'general';
update public.app_categories set description = 'Costing, selection and quotation tools' where id = 'sales';
update public.app_categories set description = 'Specialised SBU tools' where id = 'sbu';

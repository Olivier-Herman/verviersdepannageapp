-- Client facturable propre aux accidents police, par assistance (Olivier
-- 28/09/2026 : « un appel police accident pour AXA ou Ardenne Prévoyante, le
-- client Odoo est client id 36 »). Réglable dans Réglages › Sources ; vide =
-- le client par défaut de la source s'applique.
alter table public.mission_source_catalog
  add column if not exists accident_billed_to_id   integer,
  add column if not exists accident_billed_to_name text;

update public.mission_source_catalog
   set accident_billed_to_id = 36, accident_billed_to_name = 'Autres', updated_at = now()
 where key in ('axa', 'ardenne') and accident_billed_to_id is null;

notify pgrst, 'reload schema';

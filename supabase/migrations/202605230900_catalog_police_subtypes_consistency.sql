-- ============================================================
-- 202605230900_catalog_police_subtypes_consistency
-- ============================================================
-- Garantit que les sub-types Police existent dans mission_source_catalog
-- avec des cles coherentes (police_accident, police_saisie, ...).
--
-- Context : le seed initial (202605132100) avait insere 'appel_police_accident'
-- mais le code applicatif (towsoft/create, restitute, surcharges, ...) attend
-- 'police_accident' partout. Du coup la source affichee par /dispatch/new etait
-- 'POLICE > Accident' mais la cle envoyee a l API ('police_accident') n etait
-- pas en catalog -> /admin/sources ne montrait pas l entree pour la configurer.
--
-- Cette migration :
--   1. Migre 'appel_police_accident' -> 'police_accident' s il existe
--   2. Insere les 5 sub-types police s ils sont manquants (police_accident,
--      police_saisie, police_rodeo, police_avp, police_mal_garee)
--   3. Ne touche pas aux defaults (default_billed_to_id) deja configures
--
-- Apres application : l admin peut configurer le client par defaut pour
-- chaque sub-type via /admin/sources (ex: Commune de Verviers pour AVP).
-- ============================================================

-- 1. Migrer l ancienne cle appel_police_accident -> police_accident
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mission_source_catalog WHERE key = 'appel_police_accident')
  AND NOT EXISTS (SELECT 1 FROM public.mission_source_catalog WHERE key = 'police_accident') THEN
    UPDATE public.mission_source_catalog
       SET key   = 'police_accident',
           label = 'Police - Accident'
     WHERE key = 'appel_police_accident';
  END IF;
END $$;

-- 2. Inserer les sub-types manquants (UPSERT safe)
INSERT INTO public.mission_source_catalog (key, label, sort_order, active) VALUES
  ('police_accident',  'Police - Accident',  90, true),
  ('police_saisie',    'Police - Saisie',    91, true),
  ('police_rodeo',     'Police - Rodéo',     92, true),
  ('police_avp',       'Police - AVP (Abandon Voie Publique)', 93, true),
  ('police_mal_garee', 'Police - Mal garée', 94, true)
ON CONFLICT (key) DO NOTHING;

-- 3. Note : la source synthetique 'police' (parent du sub-selector dans
-- /dispatch/new) n est PAS persistee en catalog. C est une convention UI :
-- choisir "POLICE" + un sub-type stocke en BDD la source reelle police_* du
-- sub-type choisi. Si on veut un jour la persister, ajouter ici :
--   INSERT INTO mission_source_catalog (key, label, sort_order, active, notes)
--   VALUES ('police', 'Police (groupe)', 89, false, 'Meta-source UI uniquement')
--   ON CONFLICT (key) DO NOTHING;

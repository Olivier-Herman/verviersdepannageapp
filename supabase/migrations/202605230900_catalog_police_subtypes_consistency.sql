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
-- IMPORTANT : Mal Garee utilise la cle 'police_mg' (pas 'police_mal_garee') car
-- c est cette cle qui est utilisee partout dans le code existant (towsoft/create,
-- cron mg-to-avp, restitute, RestituerMalGareeModal). Le seed initial du
-- mal_garee est dans la migration 202605211000_mal_garee_source_and_fields.sql.
INSERT INTO public.mission_source_catalog (key, label, sort_order, active) VALUES
  ('police_accident', 'Police - Accident', 90, true),
  ('police_saisie',   'Police - Saisie',   91, true),
  ('police_rodeo',    'Police - Rodéo',    92, true),
  ('police_avp',      'Police - AVP (Abandon Voie Publique)', 93, true)
ON CONFLICT (key) DO NOTHING;

-- 3. Cleanup si la version precedente de cette migration a deja insere le
-- doublon 'police_mal_garee' : on le supprime SI aucune mission n y est
-- attachee (sinon on migre d abord vers police_mg).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mission_source_catalog WHERE key = 'police_mal_garee') THEN
    -- Migre les eventuelles missions creees avec la mauvaise cle
    UPDATE public.incoming_missions SET source = 'police_mg' WHERE source = 'police_mal_garee';
    -- Supprime le doublon du catalog
    DELETE FROM public.mission_source_catalog WHERE key = 'police_mal_garee';
  END IF;
END $$;

-- 3. Note : la source synthetique 'police' (parent du sub-selector dans
-- /dispatch/new) n est PAS persistee en catalog. C est une convention UI :
-- choisir "POLICE" + un sub-type stocke en BDD la source reelle police_* du
-- sub-type choisi. Si on veut un jour la persister, ajouter ici :
--   INSERT INTO mission_source_catalog (key, label, sort_order, active, notes)
--   VALUES ('police', 'Police (groupe)', 89, false, 'Meta-source UI uniquement')
--   ON CONFLICT (key) DO NOTHING;

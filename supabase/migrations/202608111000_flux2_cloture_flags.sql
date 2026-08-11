-- Flux 2 — clôture unifiée « Action » (Olivier 2026-08-11).
--
-- Rollout à 2 axes : nouveauFlux = testeur(user) ET assistance activée(mission).
-- L'axe ASSISTANCE vit ici, un flag par assistance, pilotable depuis /admin sans
-- redéploiement :
--   'off'        → personne (prod inchangée) ← valeur de départ
--   'superadmin' → phase de test (superadmins + testeurs déclarés dans le code)
--   'all'        → tous les chauffeurs, pour CETTE assistance seulement
--
-- On empile assistance par assistance, chacune validée avant la suivante :
-- Touring d'abord, puis VAB, puis Kaze. Kaze reste sur son flux actuel tant que
-- son flag est 'off' — cf project_kaze_integration (ne jamais casser Kaze).

insert into public.feature_flags (key, mode, label) values
  ('flux2_touring', 'off', 'Flux 2 — clôture unifiée « Action » (missions Touring COMEX)'),
  ('flux2_vab',     'off', 'Flux 2 — clôture unifiée « Action » (missions VAB)'),
  ('flux2_kaze',    'off', 'Flux 2 — clôture unifiée « Action » (missions Kaze)')
on conflict (key) do nothing;

-- Tronc commun de la clôture unifiée : deux informations qu'on collecte pour
-- TOUTES les assistances (même celles qui ne les demandent pas) parce qu'elles
-- sont précieuses au dispatch — où est le véhicule, et a-t-on la clé.
-- Le reste du tronc commun a déjà sa colonne : vehicle_vin, vehicle_mileage,
-- key_location, closing_notes, client_signature.
alter table public.incoming_missions
  add column if not exists vehicle_location text,
  add column if not exists key_recovered    boolean;

comment on column public.incoming_missions.vehicle_location is
  'Où le chauffeur a laissé le véhicule (Parking, Devant la maison, …) — clôture flux 2';
comment on column public.incoming_missions.key_recovered is
  'Clé récupérée par le chauffeur ? (0 ou 1, jamais 2) — clôture flux 2';

-- Sans ça, PostgREST garde son cache de schéma et les INSERT/UPDATE sur les
-- nouvelles colonnes échouent silencieusement (PGRST204).
notify pgrst, 'reload schema';

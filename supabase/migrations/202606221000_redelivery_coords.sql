-- Coordonnées (cache) de l'adresse de relivraison, pour ordonner l'onglet
-- "À Relivrer" du dispatch en tournée optimisée (plus proche voisin).
-- Géocodées à la volée par /api/missions/list puis mises en cache ici.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS redelivery_lat double precision,
  ADD COLUMN IF NOT EXISTS redelivery_lng double precision;

-- Recharger le cache de schéma PostgREST (sinon INSERT/UPDATE/SELECT sur les
-- nouvelles colonnes échouent silencieusement le temps que le cache expire).
NOTIFY pgrst, 'reload schema';

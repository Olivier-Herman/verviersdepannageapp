-- Rattrapage des coordonnées d'intervention des fiches Kaze (Olivier 09/09/2026).
--
-- Kaze fournit la position du lieu d'intervention (work_order_address.location).
-- Le mapper la lisait, mais l'INSERT de l'import ne la reprenait pas : elle
-- n'existait que dans parsed_data. Résultat, une fiche Kaze naissait sans
-- coordonnées, ses kilomètres étaient « inconnus » et la facturation par
-- dossier restait bloquée sur « à calculer » — 2CMX015 et 1DMC939, alors que
-- la grille Kaze (dépannage 83 €, 30 km inclus, 1,25 €/km) était bien en base.
--
-- L'import est corrigé pour les nouvelles fiches ; ici on récupère celles déjà
-- créées, dont la donnée dort dans parsed_data. Rien n'est écrasé : on ne
-- touche qu'aux fiches sans coordonnées.
--
-- Nom des clés : `incident_lon` dans parsed_data (mapper), `incident_lng` en
-- base — c'est précisément cet écart qui avait fait tomber la valeur.

UPDATE incoming_missions
SET incident_lat = (parsed_data->>'incident_lat')::numeric,
    incident_lng = (parsed_data->>'incident_lon')::numeric,
    updated_at   = now()
WHERE kaze_job_id IS NOT NULL
  AND (incident_lat IS NULL OR incident_lng IS NULL)
  AND parsed_data->>'incident_lat' IS NOT NULL
  AND parsed_data->>'incident_lon' IS NOT NULL
  -- Garde-fou : des coordonnées plausibles (Belgique et alentours), pour ne pas
  -- injecter une valeur aberrante dans le calcul des kilomètres facturés.
  AND (parsed_data->>'incident_lat')::numeric BETWEEN 45 AND 55
  AND (parsed_data->>'incident_lon')::numeric BETWEEN 1 AND 9;

NOTIFY pgrst, 'reload schema';

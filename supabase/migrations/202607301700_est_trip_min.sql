-- Durée par défaut (min) attribuée aux appels police sans pointage :
-- trajet A/R Dépôt → intervention → Dépôt (ORS) + 20 min. Remplie par le cron
-- estimate-police-trips, lue par le tableau de bord pour les moyennes chauffeur.
alter table incoming_missions add column if not exists est_trip_min integer;

-- Recharge le cache de schéma PostgREST (sinon INSERT/SELECT ignorent la colonne).
notify pgrst, 'reload schema';

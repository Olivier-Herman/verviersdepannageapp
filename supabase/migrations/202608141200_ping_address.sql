-- Adresse résolue d'un pointage, mémorisée une fois pour toutes.
--
-- Une position ne bouge jamais : la re-géocoder à chaque ouverture de la fiche
-- serait une dépense Google répétée pour un résultat identique. Le navigateur
-- résout l'adresse la première fois (le géocodage ne passe jamais par le
-- serveur, règle maison) puis la persiste ici. Olivier 2026-08-14.
ALTER TABLE mission_position_pings
  ADD COLUMN IF NOT EXISTS address text;

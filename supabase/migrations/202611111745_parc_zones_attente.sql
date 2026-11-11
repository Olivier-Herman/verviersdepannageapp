-- Zones d'attente (Olivier 11/11/2026) : on range le parc par ZONE, jamais par
-- rangée. Un véhicule dans une vraie zone est rangé ; un véhicule dans une zone
-- d'attente reste « à nous » (à ranger). Liste donnée par Olivier : K et K1
-- (relivraison), J (saisie), Transit (accident), LABO. Modifiable dans
-- Réglages › Plan du parc.
ALTER TABLE public.parc_zones ADD COLUMN IF NOT EXISTS zone_attente boolean NOT NULL DEFAULT false;
UPDATE public.parc_zones SET zone_attente = true WHERE key IN ('K', 'K1', 'J', 'Transit', 'LABO');

NOTIFY pgrst, 'reload schema';

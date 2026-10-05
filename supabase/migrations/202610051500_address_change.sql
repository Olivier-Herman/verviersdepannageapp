-- Changement d'adresse de livraison reçu de l'assistance pendant la mission (Olivier
-- 05/10/2026, 2DTV183 : nouvelle commande Touring « rem vers domicile » rattachée à la
-- REL sans que personne le voie → livré à l'ancienne adresse). La proposition attend la
-- décision du dispatch : { new_address, new_name, new_lat, new_lng, old_address, source,
-- ref, detected_at, decision?, decided_at?, decided_by?, driver_ack_at? }.
ALTER TABLE public.incoming_missions ADD COLUMN IF NOT EXISTS address_change jsonb;

notify pgrst, 'reload schema';

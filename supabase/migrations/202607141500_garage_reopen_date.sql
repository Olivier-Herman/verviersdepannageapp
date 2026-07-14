-- Date de réouverture d'un garage fermé : quand un véhicule revient au parc parce
-- que le garage destinataire était FERMÉ, on note la date de réouverture (info +
-- rappel le jour J au dispatch pour relivrer). Saisissable chauffeur ET dispatch.
-- Olivier 2026-07-14.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS garage_reopen_date date;

NOTIFY pgrst, 'reload schema';

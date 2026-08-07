-- Touring : lieu du véhicule de remplacement (VR), capté par re-scrutation.
-- Le lieu VR n'est PAS dans le snapshot reçu : Touring le remplit sur l'action
-- (detail/get, champs VR_NOM/RUE/CP/LOC) UNE FOIS que l'opérateur Touring a fait
-- la réservation. Le cron touring-vr-scan re-interroge COMEX chaque minute
-- (missions REM actives avec VR demandé) et stocke le lieu ici + notifie le
-- chauffeur. touring_vr_notified_at = anti-double-notif + marqueur « capté ».
alter table public.incoming_missions
  add column if not exists touring_vr_location   jsonb,
  add column if not exists touring_vr_notified_at timestamptz;

notify pgrst, 'reload schema';

-- Heure d'acceptation d'une mission Touring COMEX (posée au « Valider » qui
-- déclenche accept + délai + assign côté COMEX). Sert de base aux SLA :
-- démarré ≤10 min, sur place ≤45 min après cette heure (auto-onSpot du cron).
-- Olivier 2026-07-06.
alter table public.incoming_missions
  add column if not exists touring_accepted_at timestamptz;

notify pgrst, 'reload schema';

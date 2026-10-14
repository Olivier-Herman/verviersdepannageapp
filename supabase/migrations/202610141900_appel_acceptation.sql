-- Appel téléphonique automatique au chauffeur qui n'a pas accepté sa mission 10 minutes après
-- l'attribution (Olivier 14/10/2026) : dernier rappel, une seule fois par attribution.
alter table public.incoming_missions add column if not exists accept_call_at timestamptz;

notify pgrst, 'reload schema';

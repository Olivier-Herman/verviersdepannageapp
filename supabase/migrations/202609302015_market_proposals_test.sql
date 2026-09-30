-- Mode test des propositions de nuit (Olivier 30/09/2026) : un chauffeur ou un admin
-- lance depuis /proposition/test une proposition fictive sur SON téléphone (notif,
-- appel avec message vocal après 2 min, fin du test après 4 min). Aucune mission
-- réelle, rien à la réserve ni au dispatcher.
ALTER TABLE public.market_proposals ALTER COLUMN mission_id DROP NOT NULL;
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

notify pgrst, 'reload schema';

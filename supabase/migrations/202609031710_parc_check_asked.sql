-- 202609031710_parc_check_asked : date de la dernière demande de vérification au parc (anti re-demande).
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS parc_check_asked_at timestamptz;
NOTIFY pgrst, 'reload schema';

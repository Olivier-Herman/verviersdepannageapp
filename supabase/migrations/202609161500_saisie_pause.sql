-- Pause par dossier Parquet (remplace la bascule globale Auto/Alerte) —
-- Olivier 16/09/2026 : le robot envoie seul ; un dossier litigieux se met en
-- pause individuellement, le cron le saute (sauf l'alerte forclusion).
ALTER TABLE saisie_dossiers
  ADD COLUMN IF NOT EXISTS paused_at     timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_by     uuid REFERENCES users(id);

NOTIFY pgrst, 'reload schema';

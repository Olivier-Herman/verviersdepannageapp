-- Annulation de fiche (Dispatch / Facturation / Fourrière) : la fiche passe en
-- status='cancelled' (invisible dans l'app, conservée en base) avec un motif.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by     text;

NOTIFY pgrst, 'reload schema';

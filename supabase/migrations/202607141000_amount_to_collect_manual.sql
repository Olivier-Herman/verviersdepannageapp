-- Flag « montant à réclamer au client saisi MANUELLEMENT » : quand un dispatcher
-- édite le champ à la main, il gèle l'auto-calcul (sinon la fiche le réécrase à
-- chaque changement). Défaut false = auto-calcul actif. Olivier 2026-07-14.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS amount_to_collect_manual boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

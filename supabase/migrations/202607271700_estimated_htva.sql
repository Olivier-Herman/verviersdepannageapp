-- CA HTVA calculé (tarif source : forfait + km) figé sur la fiche, pour que les
-- stats « CA par chauffeur » comptent aussi les missions auto-facturées
-- (Touring/Mondial…) qui n'ont ni encaissement ni facture Odoo mais un tarif
-- calculé de notre côté. Rempli par le cron fill-estimated-htva. Olivier 2026-07-27.
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS estimated_htva numeric;
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS estimated_htva_at timestamptz;

NOTIFY pgrst, 'reload schema';

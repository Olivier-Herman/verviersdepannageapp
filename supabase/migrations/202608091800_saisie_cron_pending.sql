-- 202608091800_saisie_cron_pending
--
-- Cron journalier de facturation saisie. Le cron DÉTECTE les actions dues et,
-- en mode « Prépare + Alerte » (défaut), les signale sur le dossier ; en mode
-- auto (bascule ultérieure), il envoie directement. Olivier 2026-08-09.

ALTER TABLE saisie_dossiers
  ADD COLUMN IF NOT EXISTS pending_action      text,   -- facturer | gardiennage | cloture_domaine | null
  ADD COLUMN IF NOT EXISTS pending_action_at   date,   -- date de coupe suggérée pour l'action
  ADD COLUMN IF NOT EXISTS domaine_remise_date date;   -- Date IN (remise Domaine), snapshot depuis la fiche

NOTIFY pgrst, 'reload schema';

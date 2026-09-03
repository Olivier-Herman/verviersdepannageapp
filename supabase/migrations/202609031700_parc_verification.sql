-- 202609031700_parc_verification
--
-- Vérification PHYSIQUE au parc demandée à un dispatcher (popup bloquant) :
-- « ce véhicule est-il toujours là ? ». Réponse stockée sur la fiche.
-- Olivier 2026-09-03 (avant toute demande de confirmation AVP au policier).

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS parc_verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS parc_verified_present boolean,
  ADD COLUMN IF NOT EXISTS parc_verified_by      uuid REFERENCES users(id);

NOTIFY pgrst, 'reload schema';

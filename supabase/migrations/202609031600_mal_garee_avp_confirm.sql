-- 202609031600_mal_garee_avp_confirm
--
-- Une « mal garée » (police_mg) présente en parc depuis 60 jours passe
-- normalement en abandon voie publique (police_avp) — mais on demande d'abord
-- confirmation au policier (Olivier 2026-09-03). Suivi des demandes envoyées.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS avp_confirm_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS avp_confirm_count    int NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';

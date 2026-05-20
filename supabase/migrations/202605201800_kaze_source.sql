-- ============================================================
-- 202605201800_kaze_source
-- ============================================================
-- Ajoute la source "kaze" au catalogue. C est la source utilisee
-- pour TOUTES les missions arrivant via l API Kaze (IMA Benelux),
-- quelle que soit l entite assureur (Ethias / Vivium / P&V / etc).
--
-- L entite a facturer (billed_to_id/billed_to_name) est extraite
-- dynamiquement du payload Kaze a chaque mission (widget "name"
-- dans la section "Facturation/Boekhouding" du workflow).
-- ============================================================

INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('kaze', 'Kaze (IMA Benelux)', 35)
ON CONFLICT (key) DO NOTHING;

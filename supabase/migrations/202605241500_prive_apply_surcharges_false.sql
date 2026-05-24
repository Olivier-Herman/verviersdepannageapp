-- ============================================================
-- 202605241500_prive_apply_surcharges_false
-- ============================================================
-- Olivier 2026-05-24 : scenario Appel Prive — la source 'prive'
-- fonctionne au forfait négocié (saisi dans 'Paiement a reclamer
-- au client' côté dispatcher) OU en fallback au tarif police_accident
-- avec ses majorations. La source 'prive' elle-meme n'a PAS de plage
-- de majoration propre dans /admin/surcharges (sinon double majoration
-- avec le fallback police_accident).
--
-- Cf [[project-scenarios-state-2026-05-24]] et flag introduit en
-- 202605241400_catalog_apply_surcharges.
-- ============================================================

UPDATE public.mission_source_catalog
SET apply_surcharges = false
WHERE key = 'prive';

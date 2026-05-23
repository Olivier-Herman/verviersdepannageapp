-- ============================================================
-- 202605231100_tariff_km_basis_default_total
-- ============================================================
-- Inverse le default de la colonne km_basis sur source_tariffs : maintenant
-- 'total' (depot -> incident -> destination -> depot) par defaut quand un
-- nouveau tarif est cree sans valeur explicite. Le mode 'charged' reste
-- une option valide a selectionner pour les cas applicables.
--
-- Olivier 2026-05-23 : on veut que 'total' soit le choix par defaut dans
-- l UI /admin/tarifs car c est le mode le plus courant. Les tarifs
-- existants ne sont PAS modifies : chacun garde son km_basis tel qu il
-- a ete configure.
-- ============================================================

-- Seul change : le DEFAULT de la colonne (impact uniquement sur les
-- futurs INSERT sans km_basis explicite). Les rows existantes ne sont
-- pas touchees.
ALTER TABLE public.source_tariffs
  ALTER COLUMN km_basis SET DEFAULT 'total';

COMMENT ON COLUMN public.source_tariffs.km_basis IS
  'Base km de facturation. Default total (depot->incident->destination->depot, mode courant). Mode charged (incident->dest) disponible aussi pour les cas applicables.';

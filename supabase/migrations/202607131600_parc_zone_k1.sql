-- Zone K1 « En attente d'adresse » : sous-parc de relivraison pour les véhicules
-- dont l'adresse de relivraison est inconnue (ou = un de nos dépôts). Apparaît
-- automatiquement comme onglet dans le module Relivraison (zone_type='relivraison').
-- Olivier 2026-07-13.

INSERT INTO parc_zones (
  key, label, active, zone_type, is_pool, driver_allowed,
  sort_order, slot_direction, row_layout, strict_capacity, pos_x, pos_y, width, height
)
SELECT
  'K1', 'En attente d''adresse', true, 'relivraison', true, false,
  COALESCE((SELECT sort_order FROM parc_zones WHERE key = 'K'), 100) + 1,
  'ltr', 'horizontal', false, 5, 5, 15, 10
WHERE NOT EXISTS (SELECT 1 FROM parc_zones WHERE key = 'K1');

NOTIFY pgrst, 'reload schema';

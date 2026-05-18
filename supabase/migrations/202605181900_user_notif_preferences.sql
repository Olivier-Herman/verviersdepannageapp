-- supabase/migrations/202605181900_user_notif_preferences.sql
--
-- Preferences de notifications par utilisateur. Stockees en JSONB libre sur
-- users pour eviter une table dediee. Clefs reconnues (extensibles) :
--   dispatch_new_mission  : nouvelles missions (notif dispatcher)
--   driver_assigned       : mission assignee a moi (driver)
--   driver_modified       : mission modifiee apres assignation
--   cash_transfer         : transferts de caisse
--   derogation_request    : demandes de derogation
--   alert_admin           : alertes admin (towsoft error, etc.)
--
-- Default = {} (rien defini) → en absence d'entree, on traite comme activé
-- (retro-compat : tout le monde recevait tout jusqu ici).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notif_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.notif_preferences IS
  'Toggles de notification par categorie. Cles : dispatch_new_mission, driver_assigned, etc. Valeur false = desactive, absent = active.';

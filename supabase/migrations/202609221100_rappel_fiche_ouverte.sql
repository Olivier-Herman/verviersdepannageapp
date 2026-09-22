-- Rappel chauffeur : fiche assignée depuis plus de X heures et toujours pas
-- clôturée (Olivier 22/09/2026 : « Fred Palm a une fiche qui aura bientôt
-- 50 h, il faut qu'il la clôture »). Cron horaire /api/cron/rappel-fiches-ouvertes.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS open_reminder_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS open_reminder_count integer NOT NULL DEFAULT 0;
INSERT INTO app_settings (key, value, updated_at) VALUES ('rappel_fiche_ouverte_heures', '24', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('rappel_fiche_ouverte_repeat_heures', '12', now()) ON CONFLICT (key) DO NOTHING;
NOTIFY pgrst, 'reload schema';

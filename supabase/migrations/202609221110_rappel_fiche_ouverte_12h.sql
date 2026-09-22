-- Olivier 22/09/2026 : « on peut réduire à plus de 12 h » (rapatriements exclus, côté cron).
UPDATE app_settings SET value = '12', updated_at = now() WHERE key = 'rappel_fiche_ouverte_heures' AND value = '24';

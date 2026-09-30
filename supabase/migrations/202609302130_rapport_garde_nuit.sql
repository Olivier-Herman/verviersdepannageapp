-- Rapport du matin de la garde de nuit (Olivier 30/09/2026) : destinataires du mail
-- envoyé chaque jour à 8 h (bilan de la nuit). Réglage métier (groupe Dispatch)
-- modifiable dans /admin/settings. Cf /api/cron/night-report.
INSERT INTO app_settings (key, value, updated_at) VALUES ('rapport_garde_nuit_destinataires', '["mobi@verviersdepannage.be"]', now())
ON CONFLICT (key) DO NOTHING;

notify pgrst, 'reload schema';

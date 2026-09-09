-- Momo Market : fenêtre d'affichage portée de 30 à 45 minutes (Olivier 09/09/2026),
-- désormais un réglage métier (groupe Dispatch) modifiable dans /admin/settings.
INSERT INTO app_settings (key, value, updated_at) VALUES ('momo_market_fresh_minutes', '45', now())
ON CONFLICT (key) DO UPDATE SET value = '45', updated_at = now();

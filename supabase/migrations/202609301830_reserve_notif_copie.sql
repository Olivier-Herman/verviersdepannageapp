-- Réserve de nuit (Olivier 30/09/2026) : quand la réserve coupe ou remet sa notif
-- de nuit « missions libres », on prévient le dispatcher de garde + ces comptes.
-- Réglage métier (groupe Dispatch) modifiable dans /admin/settings.
INSERT INTO app_settings (key, value, updated_at) VALUES ('reserve_notif_copie', '["mobi@verviersdepannage.be"]', now())
ON CONFLICT (key) DO NOTHING;

notify pgrst, 'reload schema';

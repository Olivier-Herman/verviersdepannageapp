-- Talkie, canaux (Olivier 30/09/2026) : en plus de « Garde de nuit » (1er départ +
-- réserve + superadmins, tous visibles et pouvant parler), un canal direct par
-- chauffeur vers Mobi / IT pour signaler un souci.
ALTER TABLE public.talkie_messages ADD COLUMN IF NOT EXISTS channel_key text;
UPDATE public.talkie_messages SET channel_key = 'garde' WHERE channel_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_talkie_messages_channel ON public.talkie_messages (channel_key, created_at DESC);

-- Comptes « Mobi / IT » joignables par le canal direct de chaque chauffeur
-- (réglage métier, groupe Dispatch, modifiable dans /admin/settings).
INSERT INTO app_settings (key, value, updated_at) VALUES ('talkie_it', '["mobi@verviersdepannage.be"]', now())
ON CONFLICT (key) DO NOTHING;

notify pgrst, 'reload schema';

-- Suivi du bureau, téléphone : le 02 286 31 22 est la centrale automatique de Touring (« vous avez reçu une nouvelle
-- mission ») — compté à part, jamais en appel perdu (Olivier 24/11/2026).
update app_settings set value = jsonb_set(value::jsonb, '{appels,numeros_robots}', '{"222863122": "annonces automatiques Touring (nouvelle mission)"}'::jsonb)::text, updated_at = now()
where key = 'supervision_config';

notify pgrst, 'reload schema';

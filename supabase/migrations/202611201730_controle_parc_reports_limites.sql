-- Contrôle aléatoire du parc : la limite de reports ne vaut que pour Jona ; Mobi repousse sans limite et peut passer
-- le contrôle pour la journée (Olivier 20/11/2026). Cf src/lib/parc/controle-aleatoire.ts (estLimite, passer).
insert into app_settings (key, value, updated_at) values
  ('controle_parc_reports_limites_user_ids', '["eda29707-c9c7-47b5-ab21-084ea22201bc"]', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';

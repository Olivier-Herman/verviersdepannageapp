-- Agent mail, jour 3 : automatisation par famille (Olivier 23/09/2026).
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_agent_auto', '{}', now()) ON CONFLICT (key) DO NOTHING;

-- Agent mail : triage quotidien (Olivier 23/09/2026, jour 1). Interrupteur.
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_agent_triage', '"on"', now()) ON CONFLICT (key) DO NOTHING;

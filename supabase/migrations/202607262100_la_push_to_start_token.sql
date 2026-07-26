-- Push-to-start token ActivityKit (iOS 17.2+) par utilisateur, pour démarrer à
-- distance la Live Activity mission dès l'attribution (accepter sans ouvrir l'app).
-- Olivier 2026-07-26.
ALTER TABLE users ADD COLUMN IF NOT EXISTS la_push_to_start_token text;

-- Recharge le cache PostgREST (sinon l'UPDATE de la colonne échoue silencieusement).
NOTIFY pgrst, 'reload schema';

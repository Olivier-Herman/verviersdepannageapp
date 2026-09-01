-- FERMER L'ÉCRITURE ANONYME (Olivier 2026-09-01, alerte Supabase « Table
-- publicly accessible »).
--
-- Constat, vérifié en direct avec la clé anon — qui est PUBLIQUE par
-- construction, elle part dans le bundle du navigateur :
--   • `incoming_missions` : lecture ET écriture ouvertes (PATCH → 204).
--     Toute la base des missions : clients, téléphones, adresses, plaques,
--     montants — lisible, modifiable, supprimable par n'importe qui.
--   • `notifications_log` : lecture ouverte.
--
-- Pourquoi ces droits existent : le navigateur écoute les changements en
-- REALTIME sur ces deux tables (dispatch, facturation, liste chauffeur,
-- notifications in-app). Realtime passe par le rôle `anon` et exige un SELECT.
-- L'écriture, elle, n'a JAMAIS servi : aucune ligne du front n'écrit avec la
-- clé anon — tout passe par /api en service_role. On la retire donc sans rien
-- casser, et c'était le risque grave.
--
-- Ce que ceci NE règle PAS : la lecture reste ouverte, faute de quoi le
-- realtime s'arrête. La fermer demande de repenser le canal (broadcast
-- serveur plutôt que postgres_changes) — chantier à part, à cadrer.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON TABLE public.incoming_missions, public.notifications_log
  FROM anon, authenticated;

-- Sécurité de ceinture : les futures tables ne doivent pas hériter de droits
-- d'écriture pour anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

NOTIFY pgrst, 'reload schema';

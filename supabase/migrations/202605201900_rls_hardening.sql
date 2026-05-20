-- ============================================================
-- 202605201900_rls_hardening
-- ============================================================
-- Sécurisation RLS après advisory Supabase 2026-05-20.
--
-- Contexte : VD Soft utilise majoritairement le pattern "DISABLE RLS +
-- GRANT TO service_role uniquement". L app passe par des API routes
-- Next.js server-side qui utilisent createAdminClient (service_role).
-- MAIS certaines pages client (ParcPlanClient, MissionListClient,
-- NotificationsProvider, etc.) utilisent la cle anon directement pour
-- du Realtime et des queries directes. Cela ouvrait une expo silencieuse
-- sur les tables sans RLS.
--
-- 3 strategies appliquees selon le pattern d acces :
--   A) REVOKE anon/authenticated  : tables jamais lues client-side (API
--      routes uniquement)
--   B) RLS + policy permissive    : tables lues client-side via anon
--      (parc plan + notifications Realtime)
--   C) ENABLE RLS (deja policies) : mission_senders a des policies en place
-- ============================================================

-- ── TIER A : REVOKE (server-only) ───────────────────────────────────────────

REVOKE ALL ON public.allianz_otp_pending         FROM anon, authenticated;
REVOKE ALL ON public.assistant_conversations     FROM anon, authenticated;
REVOKE ALL ON public.assistant_messages          FROM anon, authenticated;
REVOKE ALL ON public.assistant_memory            FROM anon, authenticated;
REVOKE ALL ON public.assistant_tool_calls        FROM anon, authenticated;
REVOKE ALL ON public.dispatch_attempts_log       FROM anon, authenticated;
REVOKE ALL ON public.mission_remarks             FROM anon, authenticated;
REVOKE ALL ON public.mission_remark_attachments  FROM anon, authenticated;
REVOKE ALL ON public.inventaire_sessions         FROM anon, authenticated;
REVOKE ALL ON public.inventaire_session_items    FROM anon, authenticated;
REVOKE ALL ON public.notification_preferences    FROM anon, authenticated;
REVOKE ALL ON public.depots                      FROM anon, authenticated;
REVOKE ALL ON public.vr_locations                FROM anon, authenticated;

-- ── TIER C : mission_senders deja des policies, activation simple RLS ──────

ALTER TABLE public.mission_senders ENABLE ROW LEVEL SECURITY;

-- ── TIER B : RLS + policy permissive (anon query autorisee pour SELECT) ────

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'parc_settings',
    'parc_zones',
    'parc_rows',
    'parc_blocked_slots',
    'parc_slot_groups',
    'notifications_log'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "allow_read_all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "allow_read_all" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;

-- Service_role bypass RLS automatiquement depuis Supabase 2024 — pas de
-- policy explicite necessaire pour ces tables.

COMMENT ON POLICY "allow_read_all" ON public.parc_zones IS
  'Lecture autorisee aux clients (anon + authenticated). Ecritures restent server-side via API routes (service_role bypass RLS).';

-- ── BONUS : SET search_path sur les fonctions PL/pgSQL ─────────────────────
-- Protection contre attaques par schema malveillant (advisory linter 0011).

ALTER FUNCTION public.assign_default_driver_modules()     SET search_path = public, pg_temp;
ALTER FUNCTION public.assign_default_partner_modules()    SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_intervention_ref()         SET search_path = public, pg_temp;
ALTER FUNCTION public.user_has_module(text, text)         SET search_path = public, pg_temp;
ALTER FUNCTION public.transfer_cash_atomic(uuid)          SET search_path = public, pg_temp;
ALTER FUNCTION public.reorder_parc_rows(text, bigint[])   SET search_path = public, pg_temp;

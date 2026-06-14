-- ============================================================
-- 202606131200_police_saisie_requisitoire
-- ============================================================
-- Olivier 2026-06-13 — Police Saisie, Phase 1 : Réquisitoire.
--
-- Le bureau peut annexer un réquisitoire reçu (document scanné/PDF + note)
-- à une mission police_saisie. Phase 1 = annexion manuelle.
-- (À terme : lecture/analyse automatique des réquisitoires reçus par mail.)
--
-- Le document lui-même est stocké comme pièce jointe d'une mission_remark
-- (réutilise le bucket 'mission-remarks' + l'UI Remarques pour le download).
-- Ces colonnes servent au workflow : badge "réquisitoire reçu", date,
-- traçabilité de l'auteur, et matching futur de l'auto-annexion par mail.
-- ============================================================

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS requisitoire_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requisitoire_note     TEXT,
  ADD COLUMN IF NOT EXISTS requisitoire_doc_path TEXT,
  ADD COLUMN IF NOT EXISTS requisitoire_by       UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.incoming_missions.requisitoire_at IS
  'Date d''annexion du réquisitoire (Police Saisie). NULL = pas encore reçu.';
COMMENT ON COLUMN public.incoming_missions.requisitoire_doc_path IS
  'Chemin storage (bucket mission-remarks) du document réquisitoire annexé. Le document est aussi visible dans les Remarques de la fiche.';

-- IMPORTANT : recharge le cache PostgREST sinon les nouvelles colonnes sont
-- invisibles pour l'API (INSERT/UPDATE silencieusement KO).
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 202605181200_tariff_rules
-- ============================================================
-- Regles tarifaires dynamiques en complement de source_tariffs.
-- Permettent d ajouter/modifier le prix d une mission selon des conditions
-- complexes (date, source, type, etc.) sans toucher au tarif de base.
--
-- Exemple : "pour toute mission VAB en mai 2026, ajouter 2.50€ pour
--           participation surcharge carburant"
--
-- Workflow :
--   1. Superadmin ecrit la regle en langage naturel dans /admin/tarifs
--   2. Claude API extrait la regle structuree
--   3. Superadmin valide
--   4. Helper estimateMissionPrice applique les regles matchantes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tariff_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description         text NOT NULL,           -- phrase originale d'Olivier
  reason              text,                    -- raison metier (ex: 'Participation carburant mai 2026')

  -- Filtres (NULL = pas de filtre, applique a tout)
  filter_source       text,                    -- 'vab', 'touring', etc.
  filter_mission_type text,                    -- 'remorquage', 'depannage', etc.
  filter_date_from    date,                    -- intervention_date >= filter_date_from
  filter_date_to      date,                    -- intervention_date <= filter_date_to
  filter_client_name  text,                    -- ilike pour matching libre

  -- Operation
  operation_type      text NOT NULL,           -- 'add_fixed' | 'add_pct' | 'set_fixed'
  operation_value     numeric(10,2) NOT NULL,  -- 2.50 (add_fixed €) ou 15 (add_pct %)

  -- Meta
  active              boolean DEFAULT true,
  priority            integer DEFAULT 100,     -- ordre d application (asc) si plusieurs regles
  created_by          uuid REFERENCES public.users(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tariff_rules_active ON public.tariff_rules (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_tariff_rules_source ON public.tariff_rules (filter_source) WHERE filter_source IS NOT NULL;

ALTER TABLE public.tariff_rules DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tariff_rules TO service_role;

COMMENT ON TABLE  public.tariff_rules IS
  'Regles tarifaires dynamiques (en complement de source_tariffs). Interpretees par Claude API depuis texte libre, applicables a estimateMissionPrice selon filtres.';

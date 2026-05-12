-- ============================================================
-- Catalogue des sources de mission
-- ============================================================
-- Table de reference centrale pour les sources (Touring, Allianz, VAB, etc.).
-- Permet a l'admin d'ajouter, renommer, desactiver des sources sans toucher
-- au code. Les autres tables (surcharge_clients, future assistance_pricing,
-- mission_sources) se referent a cette cle.
--
-- Le seed inclut toutes les sources actuellement hardcodees dans le frontend.

CREATE TABLE IF NOT EXISTS public.mission_source_catalog (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  active      boolean DEFAULT true,
  sort_order  smallint DEFAULT 100,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

GRANT ALL ON public.mission_source_catalog TO service_role;

-- Seed avec les sources canoniques connues du systeme
INSERT INTO public.mission_source_catalog (key, label, sort_order) VALUES
  ('touring',                'Touring',                10),
  ('allianz',                'Allianz',                20),
  ('ethias',                 'Ethias',                 30),
  ('vivium',                 'Vivium',                 40),
  ('axa',                    'AXA',                    50),
  ('ardenne',                'Ardenne Assistance',     60),
  ('mondial',                'Mondial Assistance',     70),
  ('vab',                    'VAB',                    80),
  ('appel_police_accident',  'Appel Police - Accident', 90),
  ('prive',                  'Privé',                 100),
  ('garage',                 'Garage',                110)
ON CONFLICT (key) DO NOTHING;

-- Synchroniser depuis les sources deja vues dans les missions historiques
INSERT INTO public.mission_source_catalog (key, label)
SELECT DISTINCT
  m.source AS key,
  COALESCE(ms.label, INITCAP(REPLACE(m.source, '_', ' '))) AS label
FROM public.incoming_missions m
LEFT JOIN public.mission_sources ms ON ms.source = m.source
WHERE m.source IS NOT NULL AND m.source != ''
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE  public.mission_source_catalog IS
  'Catalogue central des sources de mission (Touring, Allianz, VAB, etc.). Ref par surcharge_clients, future assistance_pricing, mission_sources.';

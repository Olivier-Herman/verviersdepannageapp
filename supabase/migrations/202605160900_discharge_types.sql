-- ============================================================
-- 202605160900_discharge_types
-- ============================================================
-- Table des types de decharges editables depuis /admin/decharges.
-- Phase 2 du workflow decharges.
--
-- Le catalogue fige cote code (src/lib/decharges.ts) reste comme fallback
-- (au cas ou la table serait vide ou en erreur).
--
-- Realtime active pour que le chauffeur voie les modifs sans re-login.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.discharge_types (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key             TEXT UNIQUE NOT NULL,
  label           TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  footnote        TEXT,
  name_field_label TEXT,
  color           TEXT NOT NULL DEFAULT 'red' CHECK (color IN ('red', 'green')),
  needs_comment   BOOLEAN NOT NULL DEFAULT false,
  comment_label   TEXT,
  needs_photos    BOOLEAN NOT NULL DEFAULT false,
  photos_hint     TEXT,
  needs_schema    BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discharge_types_active_sort
  ON public.discharge_types(active, sort_order, label);

-- RLS activee : SELECT pour tous (chauffeur + admin via API admin),
-- mutations reservees au service_role (createAdminClient bypass RLS).
-- Plus propre que disable RLS + REVOKE — recommande par Supabase Studio.
ALTER TABLE public.discharge_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discharge_types_select_all"
  ON public.discharge_types FOR SELECT
  TO authenticated, anon
  USING (true);

-- Pas de policy INSERT/UPDATE/DELETE → seul service_role peut muter
-- (createAdminClient bypass RLS automatiquement)

GRANT SELECT ON public.discharge_types TO authenticated, anon;

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'discharge_types'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.discharge_types';
  END IF;
END $$;
ALTER TABLE public.discharge_types REPLICA IDENTITY FULL;

-- Seed initial : 13 types depuis le catalogue fige
INSERT INTO public.discharge_types (key, label, title, body, footnote, name_field_label, color, needs_comment, comment_label, needs_photos, photos_hint, needs_schema, sort_order) VALUES
  ('remorquage_vh_dommages',
   'Remorquage véhicule présentant des dommages',
   'REMORQUAGE VÉHICULE PRÉSENTANT DES DOMMAGES',
   'Le client reconnaît par la présente que les dommages repris sur le schéma annexe sont présents sur le véhicule et ne sont pas de la responsabilité de la société Verviers Dépannage ou de son personnel.',
   'Annoter le schéma + photos des dégâts.', NULL, 'red',
   false, NULL, true, 'Photos des dégâts existants AVANT prise en charge', true, 10),

  ('livraison_domicile_client',
   'Livraison au domicile du client',
   'LIVRAISON AU DOMICILE DU CLIENT',
   'Le client reconnaît par sa signature de cette décharge que son véhicule a été livré en bon état.',
   NULL, 'Nom du client réceptionnaire', 'red',
   false, NULL, false, NULL, false, 20),

  ('ouverture_portes',
   'Ouverture de portes (casser une vitre)',
   'DÉCHARGE OUVERTURE DE PORTES (CASSER UNE VITRE)',
   'Par sa signature, le client autorise le dépanneur à casser une vitre du véhicule pour procéder à l''ouverture de celui-ci.',
   NULL, 'Nom du client', 'red',
   false, NULL, false, NULL, false, 30),

  ('refus_reception_garage',
   'Refus de réception par le garage',
   'REFUS DE RÉCEPTION D''UN VÉHICULE PAR LE GARAGE',
   'Par sa signature, le garage réceptionnaire confirme qu''il refuse la réception du véhicule.',
   NULL, 'Nom de la personne qui refuse', 'red',
   true, 'Motif (si possible)', false, NULL, false, 40),

  ('depot_voie_publique',
   'Dépôt sur voie publique',
   'DÉPÔT D''UN VÉHICULE SUR LA VOIE PUBLIQUE',
   'À la demande express du client, le véhicule est laissé sur le domaine public sous son entière responsabilité et décharge la société Verviers Dépannage de toute responsabilité en cas de dommages subis sur le véhicule.',
   NULL, NULL, 'red',
   false, NULL, false, NULL, false, 50),

  ('enlevement_police_sans_client',
   'Enlèvement police sans client',
   'DEMANDE D''ENLÈVEMENT D''UN VÉHICULE PAR L''AUTORITÉ SANS LA PRÉSENCE DU CLIENT',
   'L''enlèvement du véhicule est effectué par la société de dépannage sans la présence du client et à la demande de l''autorité.',
   NULL, 'Nom du demandeur (autorité)', 'red',
   false, NULL, false, NULL, false, 60),

  ('enlevement_au_garage',
   'Enlèvement d''un véhicule au garage',
   'ENLÈVEMENT D''UN VÉHICULE AU GARAGE',
   'Le garage réceptionnaire reconnaît que la société Verviers Dépannage a enlevé le véhicule en sa concession et réalisé en sa présence l''inspection du véhicule.',
   NULL, 'Nom de la personne qui réceptionne', 'red',
   false, NULL, false, NULL, false, 70),

  ('fin_intervention_sans_degats',
   'Fin d''intervention sans dégâts supplémentaires',
   'FIN D''INTERVENTION',
   'Le client reconnaît par la présente qu''aucun dommage supplémentaire n''est à déplorer suite à l''intervention de la société Verviers Dépannage.',
   NULL, NULL, 'green',
   false, NULL, false, NULL, false, 80),

  ('livraison_au_garage',
   'Livraison au garage',
   'LIVRAISON D''UN VÉHICULE AU GARAGE',
   'Le garage réceptionnaire reconnaît que la société Verviers Dépannage a livré le véhicule en sa concession et réalisé en sa présence l''inspection du véhicule.',
   NULL, 'Nom de la personne qui réceptionne', 'red',
   false, NULL, false, NULL, false, 90),

  ('dsp_avec_risques',
   'DSP avec risques',
   'DÉPANNAGE SUR PLACE PRÉSENTANT UN/DES RISQUES',
   'Le client demande le dépannage sur place de son véhicule et dégage la société Verviers Dépannage et son personnel de toute responsabilité en cas de dommages subis sur le véhicule lors de l''intervention.',
   NULL, NULL, 'red',
   true, 'Description du/des risque(s)', false, NULL, false, 100),

  ('dsp_provisoire',
   'DSP provisoire',
   'DÉPANNAGE SUR PLACE PROVISOIRE',
   E'Par sa signature, le client reconnaît avoir été informé que le dépannage effectué par nos services est un dépannage provisoire.\n\nLe client s''engage à aller directement au garage pour effectuer le contrôle ou la réparation de son véhicule.\n\nVerviers Dépannage et son personnel ne pourront pas être tenus responsables si le passage par le garage n''est pas effectué directement.',
   NULL, NULL, 'red',
   false, NULL, false, NULL, false, 110),

  ('vh_laisse_sur_place',
   'Véhicule laissé sur place',
   'DÉCHARGE VÉHICULE LAISSÉ SUR PLACE',
   'À la demande express du client, le véhicule est laissé sur place.',
   NULL, NULL, 'red',
   false, NULL, false, NULL, false, 120),

  ('declaration_degats_intervention',
   'Déclaration de dégâts effectués sur le véhicule',
   'LORS DE L''INTERVENTION DE VERVIERS DÉPANNAGE, LE VÉHICULE A SUBI UN/DES DOMMAGE(S)',
   'Le client reconnaît par la présente que le(s) dommage(s) repris sur le schéma suivant correspond(ent) totalement au(x) dégât(s) engendré(s).',
   'Annoter le schéma + détails dans le commentaire + photos des dégâts.', NULL, 'red',
   true, 'Détail des dommages', true, 'Photos précises des dommages causés pendant l''intervention', true, 130)
ON CONFLICT (key) DO NOTHING;

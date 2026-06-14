-- ============================================================
-- 202606131400_police_saisie_domaine
-- ============================================================
-- Olivier 2026-06-13 — Police Saisie, Phase 4 : Remise au Domaine (État belge).
--
-- Quand le propriétaire ne se met pas en ordre, le policier décide d'envoyer le
-- véhicule au Domaine (État). Il sera vendu aux enchères puis enlevé par un
-- épaviste. C'est l'issue ALTERNATIVE à la levée de saisie.
--
-- Le bouton Domaine annexe un document OU un commentaire + une DATE DE REMISE
-- + une DATE DE VENTE (cette dernière souvent connue plus tard).
--
-- FACTURATION :
--   - La date de remise domaine = FIN de la période facturable au client / au
--     parquet (le gardiennage parquet s'arrête à cette date).
--   - De la date de remise JUSQU'À la date de vente : jours au tarif parc saisie
--     (même tarif que le gardiennage saisie), comptabilisés pour l'ÉTAT
--     (Domaine) -> tableau Excel trimestriel (export construit ultérieurement).
-- ============================================================

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS domaine_at          TIMESTAMPTZ,  -- date d'enregistrement de la remise
  ADD COLUMN IF NOT EXISTS domaine_remise_date DATE,         -- remise au Domaine -> fin facturation client/parquet
  ADD COLUMN IF NOT EXISTS domaine_vente_date  DATE,         -- vente aux enchères (souvent renseignée plus tard)
  ADD COLUMN IF NOT EXISTS domaine_note        TEXT,
  ADD COLUMN IF NOT EXISTS domaine_doc_path    TEXT,
  ADD COLUMN IF NOT EXISTS domaine_by          UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.incoming_missions.domaine_remise_date IS
  'Date de remise au Domaine (État). Fin de la période de gardiennage facturable au client/parquet. Les jours remise->vente sont facturés à l''État au tarif parc saisie (Excel trimestriel).';
COMMENT ON COLUMN public.incoming_missions.domaine_vente_date IS
  'Date de vente aux enchères par le Domaine (renseignée plus tard). Borne le décompte des jours facturés à l''État.';

NOTIFY pgrst, 'reload schema';

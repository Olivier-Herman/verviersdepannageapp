-- src/supabase/migrations/202606040300_towsoft_migration_source.sql
--
-- Olivier 2026-06-04 : table source pour la migration TowSoft -> VD Soft.
-- Reconstitue la fourriere par scan-to-place zone par zone. Cf brief technique
-- complet dans les notes session 2026-06-04.
--
-- Contient les 733 fiches TowSoft (refresh via cron). Le scan terrain coche
-- flag_scanned = true puis un job de fond cree la mission VD Soft dans
-- incoming_missions (lien via vdsoft_mission_id).
--
-- Les non-scannes (flag=false) = archive read-only "fantomes / sortis avant
-- migration". Pas de mission VD Soft creee pour eux.

CREATE TABLE IF NOT EXISTS public.towsoft_migration_source (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cle d idempotence : n° fiche TowSoft (unique)
  towsoft_num         TEXT UNIQUE NOT NULL,

  -- Snapshot brut de la ligne aaData (allImpoundListCallServerSide)
  raw_list_data       JSONB NOT NULL,

  -- Champs extraits pour search rapide (depuis raw_list_data)
  plate               TEXT,
  vin                 TEXT,
  brand               TEXT,
  model               TEXT,
  motif               TEXT,                -- Accident, Saisie, Mal Garee, ...
  date_entree         TIMESTAMPTZ,         -- DATE + HEURE TowSoft (col10)
  parc_towsoft        TEXT,                -- info uniquement (NE PAS utiliser pour placement)
  client_name         TEXT,
  appel_type          TEXT,                -- "Appel Police - Accident", ...

  -- Detail enrichi (rempli par cron 5 endpoints, en background)
  detail_payload      JSONB,               -- {charges, origine, destination, client, ...}
  detail_fetched_at   TIMESTAMPTZ,
  detail_error        TEXT,                -- si scrape KO

  -- Etat de migration cote terrain
  flag_scanned        BOOLEAN NOT NULL DEFAULT false,
  scanned_at          TIMESTAMPTZ,
  scanned_zone        TEXT,                -- zone physique VD Soft (declaree par operateur)
  scanned_by_user     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  scanned_qr_format   TEXT,                -- 'towsoft', 'qr_mission', 'v_legacy', 'manual_plate'

  -- Resultat de creation mission VD Soft (via worker)
  vdsoft_mission_id   UUID REFERENCES public.incoming_missions(id) ON DELETE SET NULL,
  imported_at         TIMESTAMPTZ,
  import_attempts     INTEGER NOT NULL DEFAULT 0,
  import_error        TEXT,
  next_import_retry_at TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Search par plaque / VIN (matching scan)
CREATE INDEX IF NOT EXISTS idx_tms_plate
  ON public.towsoft_migration_source (plate);
CREATE INDEX IF NOT EXISTS idx_tms_vin
  ON public.towsoft_migration_source (vin);

-- Filtres communs
CREATE INDEX IF NOT EXISTS idx_tms_scanned_zone
  ON public.towsoft_migration_source (flag_scanned, scanned_zone);
CREATE INDEX IF NOT EXISTS idx_tms_pending_import
  ON public.towsoft_migration_source (next_import_retry_at)
  WHERE flag_scanned = true AND imported_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tms_pending_enrich
  ON public.towsoft_migration_source (detail_fetched_at)
  WHERE detail_fetched_at IS NULL;

-- RLS off (admin only via /api)
ALTER TABLE public.towsoft_migration_source DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.towsoft_migration_source TO service_role;
GRANT SELECT ON public.towsoft_migration_source TO authenticated;

COMMENT ON TABLE public.towsoft_migration_source IS
  'Table source pour migration TowSoft -> VD Soft (scan-to-place zone par zone). '
  'Cf module /fourriere/migration (acces module fourriere). '
  'Workflow : init (733 lignes) -> cron enrichit details -> operateur scanne en '
  'zone -> worker cree mission VD Soft + Odoo + place dans incoming_missions.';

NOTIFY pgrst, 'reload schema';

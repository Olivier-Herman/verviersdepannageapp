-- src/supabase/migrations/202606040400_orphan_scans.sql
--
-- Olivier 2026-06-04 : table des "fantomes inverses" = vehicules scannes
-- physiquement mais ABSENTS de TowSoft. On les loggue pour qu un operateur
-- fourriere les investigue manuellement (verif Odoo helpdesk + creation
-- fiche via PoliceClient si vraiment nouveau).
--
-- Page /fourriere/migration/orphans liste ces scans non resolus.

CREATE TABLE IF NOT EXISTS public.orphan_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_input       TEXT NOT NULL,                -- ce que l operateur a scanne
  parsed_format   TEXT,                          -- 'plate', 'vin', 'towsoft_url', etc.
  plate           TEXT,
  vin             TEXT,
  zone            TEXT NOT NULL,                 -- zone declaree par operateur
  scanned_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Resolution manuelle
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_action     TEXT,                      -- 'created_in_vdsoft', 'found_in_odoo', 'ignored', etc.
  resolved_mission_id UUID REFERENCES public.incoming_missions(id) ON DELETE SET NULL,
  resolution_notes    TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orphan_scans_unresolved
  ON public.orphan_scans (zone, scanned_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.orphan_scans DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.orphan_scans TO service_role;
GRANT SELECT ON public.orphan_scans TO authenticated;

COMMENT ON TABLE public.orphan_scans IS
  'Fantomes inverses : vehicules scannes physiquement absents de TowSoft. '
  'Liste consultable via /fourriere/migration/orphans pour investigation manuelle.';

NOTIFY pgrst, 'reload schema';

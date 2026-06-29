-- Sources internes sans facturation (ex. Car Parts & Recycling) : la mission est
-- créée, exécutée par le chauffeur, puis archivée directement (status=completed)
-- sans passer par /facturation. Flag configurable depuis /admin/sources.
-- Olivier 2026-06-29.
ALTER TABLE mission_source_catalog
  ADD COLUMN IF NOT EXISTS skip_facturation boolean NOT NULL DEFAULT false;

-- Car Parts & Recycling = société interne, transport uniquement, jamais facturé.
UPDATE mission_source_catalog SET skip_facturation = true WHERE key = 'garage_j7772c';

NOTIFY pgrst, 'reload schema';

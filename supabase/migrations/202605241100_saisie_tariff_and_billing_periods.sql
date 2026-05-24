-- ============================================================
-- 202605241100_saisie_tariff_and_billing_periods
-- ============================================================
-- Olivier 2026-05-24 brief Saisie :
-- - Source : Police, depose Pepinster zone J (ou Transit si plein)
-- - Tarif annuel : un vehicule saisi en 2025 garde le tarif 2025 jusqu au
--   31/12, puis bascule sur le tarif 2026 a partir du 1/1/26 pour la
--   partie gardiennage 2026, etc.
-- - 3 destinataires de facturation possibles :
--     - Client (avec frais admin)
--     - Parquet (sans frais admin)
--     - Domaine (sans frais admin)
-- - 1 devis Odoo par saisie, plusieurs lignes (une par periode avec dates
--   de-a). Odoo gere les factures multiples sur le devis.
-- - Cron mensuel/bimensuel met a jour le devis avec les periodes ecoulees.
--
-- Pour cette session : ossature minimale :
--   1. Grilles tarifaires placeholders 2025 et 2026 (mode lines, sans
--      lignes pre-remplies — Olivier remplira via /admin/tarifs).
--   2. Table mission_billing_periods : trace des periodes facturees
--      (debut/fin, destinataire, qty, montant, lien vers devis Odoo).
--
-- Le calcul annuel, le cron, et la page admin "Saisies a facturer" seront
-- implementes dans une session dediee facturation Saisie (cf memory
-- [[facturation-saisie-module]]).
-- ============================================================

-- 1. Grille tarif Saisie 2025 (placeholder, lignes a remplir par Olivier)
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, effective_to, notes
)
SELECT 'police_saisie', 'remorquage', 'lines', NULL, 'total',
       '2025-01-01', '2025-12-31',
       'Tarif Saisie 2025. Brief Olivier 2026-05-24. Lignes a completer via /admin/tarifs (PEC, treuil, km, MO, gardiennage 2025, frais admin client uniquement).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_saisie' AND mission_type = 'remorquage'
    AND effective_from = '2025-01-01'
);

-- 2. Grille tarif Saisie 2026 (placeholder)
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_saisie', 'remorquage', 'lines', NULL, 'total',
       '2026-01-01',
       'Tarif Saisie 2026. Lignes a completer via /admin/tarifs.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_saisie' AND mission_type = 'remorquage'
    AND effective_from = '2026-01-01' AND effective_to IS NULL
);

-- 3. Table des periodes de facturation
-- Une ligne par "periode" facturee. Pour les saisies :
--   - 1ere ligne : dépannage + gardiennage du lendemain saisie au dernier
--     jour du mois suivant
--   - puis 1 ligne par tranche de 2 mois (cron auto)
--   - quand basculement parquet -> domaine : nouvelle ligne avec
--     billed_to_kind='domaine'
--   - quand reversion (levee saisie tardive) : credit + nouvelle ligne client
CREATE TABLE IF NOT EXISTS public.mission_billing_periods (
  id                BIGSERIAL PRIMARY KEY,
  mission_id        UUID NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  period_from       DATE NOT NULL,
  period_to         DATE NOT NULL,
  billed_to_kind    TEXT NOT NULL CHECK (billed_to_kind IN ('client', 'parquet', 'domaine')),
  billed_to_id      INTEGER,                  -- Odoo partner_id du destinataire concret
  billed_to_name    TEXT,                     -- cache du nom
  qty               NUMERIC(10, 4) NOT NULL,  -- ex: 31 jours
  unit_price        NUMERIC(10, 2) NOT NULL,  -- ex: 20.00 € HTVA
  amount_htva       NUMERIC(10, 2) NOT NULL,  -- = qty * unit_price (calcule cote app)
  description       TEXT,                     -- ex: "Gardiennage 14/04/2025 -> 31/05/2025"
  tariff_id         UUID REFERENCES public.source_tariffs(id),
  odoo_quote_id     INTEGER,                  -- meme devis pour toutes les periodes d une saisie
  odoo_line_id      INTEGER,                  -- ligne sale.order.line correspondante
  invoiced_at       TIMESTAMPTZ,              -- non-null = ligne deja facturee (cf invoice_status Odoo)
  credited_at       TIMESTAMPTZ,              -- non-null = ligne creditee (NC Odoo)
  credit_note_for   BIGINT REFERENCES public.mission_billing_periods(id),  -- pointe vers la ligne creditee
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  CHECK (period_to >= period_from)
);

CREATE INDEX IF NOT EXISTS idx_mission_billing_periods_mission
  ON public.mission_billing_periods(mission_id, period_from);

CREATE INDEX IF NOT EXISTS idx_mission_billing_periods_quote
  ON public.mission_billing_periods(odoo_quote_id);

CREATE INDEX IF NOT EXISTS idx_mission_billing_periods_kind
  ON public.mission_billing_periods(billed_to_kind, invoiced_at);

ALTER TABLE public.mission_billing_periods DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.mission_billing_periods TO service_role;
GRANT USAGE, SELECT ON SEQUENCE mission_billing_periods_id_seq TO service_role;

COMMENT ON TABLE public.mission_billing_periods IS
  'Periodes de facturation pour les missions Saisie (et possiblement autres scenarios de gardiennage longue duree). 1 mission = 1 devis Odoo (odoo_quote_id partage), plusieurs periodes (lignes du devis) facturees chacune avec son destinataire (client/parquet/domaine).';

COMMENT ON COLUMN public.mission_billing_periods.billed_to_kind IS
  'Destinataire de cette periode : client (avec frais admin) / parquet / domaine.';

COMMENT ON COLUMN public.mission_billing_periods.credit_note_for IS
  'Si non null : cette ligne est une note de credit (NC) qui annule la ligne pointee. Cas : levee de saisie tardive apres facturation Domaine -> on credite la facture Domaine et on refacture le client.';

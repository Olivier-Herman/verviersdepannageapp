-- Francofolies — Phase 2 (enlèvement)
-- Fige la tarification au moment de l'enlèvement pour que la facturation
-- reconstruise exactement les lignes du devis (SERV-DIV réquisition + gardiennage),
-- indépendamment d'un changement ultérieur des réglages superadmin.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS ff_base_htva        numeric,   -- PU HTVA ligne SERV-DIV (prix réquisition)
  ADD COLUMN IF NOT EXISTS ff_gardiennage_days integer,   -- nb jours gardiennage retenus
  ADD COLUMN IF NOT EXISTS ff_gardiennage_pu   numeric;   -- PU HTVA / jour gardiennage figé

NOTIFY pgrst, 'reload schema';

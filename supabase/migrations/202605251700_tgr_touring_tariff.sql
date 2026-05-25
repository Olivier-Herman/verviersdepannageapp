-- ============================================================
-- 202605251700_tgr_touring_tariff
-- ============================================================
-- Olivier 2026-05-25 : "TGR touring se sont des mission de REM. Tarif
-- 2eur par kilometre charge (donc de Lieu d intervention jusqu a lieu
-- de livraison)".
--
-- Mode 'forfait' simple : pas de forfait initial, juste km × prix.
--   - unit_price = 0
--   - km_inclus  = 0
--   - km_price   = 2.00 EUR/km
--   - km_basis   = 'charged' (incident -> destination, PAS depot -> ...)
--
-- La cle source en BDD est 'tgr' (seed initial 001_initial_schema) mais
-- certaines migrations display_color mentionnent 'tgr_touring' qui n a
-- jamais ete INSERT dans le catalog. On detecte la cle existante (l une
-- OU l autre) et on insere le tarif pour celle qui est en BDD. Safe :
-- si aucune n existe, la migration ne fait rien plutot que de creer un
-- tarif orphelin.
-- ============================================================

DO $$
DECLARE
  tgr_key TEXT;
BEGIN
  -- Trouve la cle TGR effectivement presente dans le catalog
  SELECT key INTO tgr_key
  FROM public.mission_source_catalog
  WHERE key IN ('tgr', 'tgr_touring')
  ORDER BY (key = 'tgr_touring')::int DESC  -- preference tgr_touring si les 2 existent
  LIMIT 1;

  IF tgr_key IS NULL THEN
    RAISE NOTICE 'Aucune source TGR trouvee dans mission_source_catalog. Ajout du tarif annule.';
    RETURN;
  END IF;

  -- INSERT idempotent : ne fait rien si un tarif courant existe deja
  IF NOT EXISTS (
    SELECT 1 FROM public.source_tariffs
    WHERE source = tgr_key
      AND mission_type = 'remorquage'
      AND effective_to IS NULL
  ) THEN
    INSERT INTO public.source_tariffs (
      source, mission_type, pricing_mode, vehicle_class, km_basis,
      unit_price, km_inclus, km_price, effective_from, notes
    )
    VALUES (
      tgr_key, 'remorquage', 'forfait', NULL, 'charged',
      0.00, 0, 2.00, CURRENT_DATE,
      'Tarif TGR Touring : 2 EUR par km charge (incident -> destination). Pas de forfait initial. Olivier 2026-05-25.'
    );
    RAISE NOTICE 'Tarif TGR Touring insere pour source=%', tgr_key;
  ELSE
    RAISE NOTICE 'Un tarif TGR Touring existe deja pour source=%, INSERT skippe.', tgr_key;
  END IF;
END $$;

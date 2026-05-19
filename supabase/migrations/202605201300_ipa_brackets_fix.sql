-- ============================================================
-- 202605201300_ipa_brackets_fix
-- ============================================================
-- Correctifs sur le seed IPA initial :
--
-- 1. La cle canonique dans mission_source_catalog / surcharge_clients
--    est 'ardenne' (pas 'ardenne_prevoyante'). On renomme les lignes
--    seedees pour que le lookup par source matche bien les missions.
--
-- 2. Le tarif IPA s applique aussi bien aux REM (remorquage) qu aux
--    DSP (depannage). On duplique les entrees source_tariffs et les
--    57 brackets pour mission_type='depannage'.
-- ============================================================

-- 1. Rename ardenne_prevoyante -> ardenne dans les 2 tables
UPDATE public.source_tariffs
   SET source = 'ardenne'
 WHERE source = 'ardenne_prevoyante';

UPDATE public.source_tariff_brackets
   SET source = 'ardenne'
 WHERE source = 'ardenne_prevoyante';

-- 2. Duplique source_tariffs pour mission_type='depannage' (DSP)
--    en partant des entrees REM en mode brackets pour axa + ardenne.
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, km_basis,
  beyond_max_km, beyond_max_step_km, beyond_max_step_price,
  effective_from, notes
)
SELECT
  source,
  'depannage',
  pricing_mode,
  km_basis,
  beyond_max_km,
  beyond_max_step_km,
  beyond_max_step_price,
  effective_from,
  'Tarif IPA depannage (memes valeurs que remorquage). Cf migration 202605201300_ipa_brackets_fix.'
FROM public.source_tariffs
WHERE source IN ('axa', 'ardenne')
  AND mission_type = 'remorquage'
  AND pricing_mode = 'brackets'
ON CONFLICT DO NOTHING;

-- 3. Duplique les brackets pour mission_type='depannage' (DSP)
INSERT INTO public.source_tariff_brackets (
  source, mission_type, from_km, to_km,
  price_normal, price_majore, effective_from
)
SELECT
  source,
  'depannage',
  from_km, to_km,
  price_normal, price_majore,
  effective_from
FROM public.source_tariff_brackets
WHERE source IN ('axa', 'ardenne')
  AND mission_type = 'remorquage'
ON CONFLICT (source, mission_type, from_km, to_km, effective_from) DO NOTHING;

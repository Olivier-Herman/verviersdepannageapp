-- ============================================================
-- 202605201200_source_tariff_brackets
-- ============================================================
-- Nouveau mode de tarification "brackets" pour les sources IPA
-- (Inter Partner Assistance = AXA + Ardenne Prevoyante).
--
-- Contrairement au mode classique (forfait + km_inclus + km_price),
-- IPA tarife par TRANCHE de km :
--   - 0-20 km     : 57 normal / 77 majoré
--   - 21-25 km    : 68 normal / 91 majoré
--   - ... (59 tranches jusqu a 296-300 km)
--   - Au-dela 300 km : prix tranche 296-300 + 8 EUR par tranche de 10 km
--
-- La majoration "horaire" est INTEGREE dans le tarif (price_majore) :
--   - Majore si : heure < 7 OU heure >= 18 OU samedi/dimanche OU jour ferie BE
--   - Pas d application des surcharge_rules classiques par-dessus
--
-- Km comptes = km totaux (depot -> incident -> destination -> retour depot).
-- Donc km_basis = 'total' pour les sources IPA.
-- ============================================================

-- 1. Extension source_tariffs : pricing_mode + params au-dela du max
ALTER TABLE public.source_tariffs
  ADD COLUMN IF NOT EXISTS pricing_mode          text NOT NULL DEFAULT 'forfait'
    CHECK (pricing_mode IN ('forfait', 'brackets')),
  ADD COLUMN IF NOT EXISTS beyond_max_km         integer,
  ADD COLUMN IF NOT EXISTS beyond_max_step_km    integer,
  ADD COLUMN IF NOT EXISTS beyond_max_step_price numeric(10,2);

COMMENT ON COLUMN public.source_tariffs.pricing_mode IS
  '"forfait" (default) = forfait + km_inclus + km_price + surcharges classiques. "brackets" = tarif par tranche depuis source_tariff_brackets (majoration horaire incluse).';
COMMENT ON COLUMN public.source_tariffs.beyond_max_km IS
  'Limite max des brackets (ex 300). Au-dela, prix = bracket max + steps × beyond_max_step_price. Null si pas applicable.';
COMMENT ON COLUMN public.source_tariffs.beyond_max_step_km IS
  'Taille d une tranche au-dela du max (ex 10 km).';
COMMENT ON COLUMN public.source_tariffs.beyond_max_step_price IS
  'Prix par tranche au-dela du max (ex 8.00 EUR).';

-- 2. Table des brackets de tarification par tranche de km
CREATE TABLE IF NOT EXISTS public.source_tariff_brackets (
  id              bigserial PRIMARY KEY,
  source          text NOT NULL,
  mission_type    text NOT NULL,
  from_km         integer NOT NULL CHECK (from_km >= 0),
  to_km           integer NOT NULL CHECK (to_km >= from_km),
  price_normal    numeric(10,2) NOT NULL,
  price_majore    numeric(10,2) NOT NULL,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  notes           text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (source, mission_type, from_km, to_km, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_source_tariff_brackets_lookup
  ON public.source_tariff_brackets (source, mission_type, effective_from DESC);

ALTER TABLE public.source_tariff_brackets DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.source_tariff_brackets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE source_tariff_brackets_id_seq TO service_role;

COMMENT ON TABLE public.source_tariff_brackets IS
  'Tranches de tarification par km pour sources IPA (AXA, Ardenne Prevoyante, etc.). Active si source_tariffs.pricing_mode = brackets.';

-- 3. Seed source_tariffs : AXA et Ardenne Prevoyante en mode brackets, km totaux
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, km_basis,
  beyond_max_km, beyond_max_step_km, beyond_max_step_price,
  effective_from, notes
) VALUES
  ('axa',                'remorquage', 'brackets', 'total', 300, 10, 8.00, '2022-01-01',
    'Tarif IPA par tranche de km. Majoration horaire incluse (18h-7h + sa + di + jf). Au-dela de 300 km : prix tranche 296-300 + 8 EUR par 10 km.'),
  ('ardenne_prevoyante', 'remorquage', 'brackets', 'total', 300, 10, 8.00, '2022-01-01',
    'Tarif IPA par tranche de km. Mêmes valeurs qu AXA (groupe IPA = Inter Partner Assistance). Majoration horaire incluse (18h-7h + sa + di + jf).')
ON CONFLICT DO NOTHING;

-- 4. Seed des 59 brackets IPA, dupliques pour AXA + Ardenne Prevoyante
WITH ipa_brackets(from_km, to_km, price_normal, price_majore) AS (VALUES
    (  0,  20,  57,  77),
    ( 21,  25,  68,  91),
    ( 26,  30,  73,  98),
    ( 31,  35,  78, 106),
    ( 36,  40,  83, 113),
    ( 41,  45,  89, 120),
    ( 46,  50,  94, 127),
    ( 51,  55, 100, 135),
    ( 56,  60, 106, 143),
    ( 61,  65, 111, 150),
    ( 66,  70, 116, 157),
    ( 71,  75, 121, 164),
    ( 76,  80, 127, 171),
    ( 81,  85, 132, 178),
    ( 86,  90, 137, 185),
    ( 91,  95, 142, 192),
    ( 96, 100, 148, 199),
    (101, 105, 151, 204),
    (106, 110, 156, 210),
    (111, 115, 160, 217),
    (116, 120, 165, 223),
    (121, 125, 170, 229),
    (126, 130, 174, 235),
    (131, 135, 179, 242),
    (136, 140, 184, 248),
    (141, 145, 188, 254),
    (146, 150, 193, 260),
    (151, 155, 197, 267),
    (156, 160, 202, 273),
    (161, 165, 207, 279),
    (166, 170, 211, 285),
    (171, 175, 216, 291),
    (176, 180, 220, 298),
    (181, 185, 225, 304),
    (186, 190, 230, 310),
    (191, 195, 234, 316),
    (196, 200, 239, 323),
    (201, 205, 243, 328),
    (206, 210, 247, 333),
    (211, 215, 251, 338),
    (216, 220, 255, 344),
    (221, 225, 259, 349),
    (226, 230, 263, 354),
    (231, 235, 267, 360),
    (236, 240, 270, 365),
    (241, 245, 274, 370),
    (246, 250, 278, 376),
    (251, 255, 282, 381),
    (256, 260, 286, 387),
    (261, 265, 290, 392),
    (266, 270, 294, 397),
    (271, 275, 298, 403),
    (276, 280, 302, 408),
    (281, 285, 306, 413),
    (286, 290, 310, 419),
    (291, 295, 314, 424),
    (296, 300, 318, 429)
)
INSERT INTO public.source_tariff_brackets
  (source, mission_type, from_km, to_km, price_normal, price_majore, effective_from)
SELECT s.src, 'remorquage', b.from_km, b.to_km, b.price_normal, b.price_majore, '2022-01-01'::date
FROM ipa_brackets b
CROSS JOIN (VALUES ('axa'), ('ardenne_prevoyante')) AS s(src)
ON CONFLICT (source, mission_type, from_km, to_km, effective_from) DO NOTHING;

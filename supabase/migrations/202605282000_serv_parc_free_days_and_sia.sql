-- Olivier 2026-05-28 : tarif gardiennage SIA (police_snc + sia_couvert).
--
-- 1. Nouvelle colonne free_days sur source_tariff_lines : nombre de jours
--    offerts avant facturation du gardiennage. Specifique au SC (Siabis
--    Couvert) qui offre les 3 premiers jours.
--
-- 2. Insertion des lignes SERV-PARC manquantes pour police_snc et sia_couvert
--    a 20 EUR TVAC / jour (= 16.5289 HT, TVA 21%).
--
-- Les lignes existent en vehicle_class NULL (generique, applicable car+moto).
-- Olivier pourra raffiner via /admin/tarifs s il veut un tarif cyclo distinct.

-- 1. Ajout colonne free_days
ALTER TABLE public.source_tariff_lines
  ADD COLUMN IF NOT EXISTS free_days INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.source_tariff_lines.free_days IS
  'Nombre de jours offerts avant facturation. S applique aux lignes SERV-PARC. Ex: SC = 3 (les 3 premiers jours en parc sont gratuits).';

-- 2. Insertion lignes SNC (police_snc) — facturation des le J1
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, effective_to, vehicle_class, free_days, notes
)
SELECT 'police_snc', 'remorquage', 99, 'SERV-PARC',
       'Frais de gardiennage (par jour)',
       NULL, 16.5289, NULL, false,
       '2025-01-01', NULL, NULL, 0,
       'SIA non couvert : 20 EUR TVAC / jour des le premier jour. Olivier 2026-05-28.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_snc' AND kind = 'SERV-PARC'
);

-- 3. Insertion lignes SC (sia_couvert) — 3 jours gratuits puis facturation
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, effective_to, vehicle_class, free_days, notes
)
SELECT 'sia_couvert', 'remorquage', 99, 'SERV-PARC',
       'Frais de gardiennage (par jour, apres 3 jours offerts)',
       NULL, 16.5289, NULL, false,
       '2025-01-01', NULL, NULL, 3,
       'SIA couvert : 3 premiers jours gratuits, puis 20 EUR TVAC / jour. Olivier 2026-05-28.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'sia_couvert' AND kind = 'SERV-PARC'
);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 202606141600_saisie_prix_majores
-- ============================================================
-- Olivier 2026-06-14 — Police Saisie : restauration des PRIX MAJORÉS
-- (default_price_majore) sur les lignes PEC et Km.
--
-- La majoration Saisie (nuit / week-end / jour férié) est encodée dans un prix
-- distinct (pas un pourcentage). Les créneaux /admin/surcharges Police-Saisie
-- servent d'interrupteur : dès qu'une période matche, estimateMissionPrice
-- bascule sur default_price_majore.
--
-- Ces valeurs avaient été perdues (NULL) lors d'éditions via /admin/tarifs.
--   2026 : PEC 94,06 → 141,1100 ; Km 1,5717 → 2,3950
--   2025 : PEC 92,01 → 138,0300 ; Km 1,5717 → 2,3428
-- (voiture ET cyclo : même prix majoré)
-- ============================================================

UPDATE public.source_tariff_lines SET default_price_majore = 141.1100
WHERE source = 'police_saisie' AND kind = 'SERV-PEC' AND effective_from = '2026-01-01';

UPDATE public.source_tariff_lines SET default_price_majore = 2.3950
WHERE source = 'police_saisie' AND kind = 'SERV-KM' AND effective_from = '2026-01-01';

UPDATE public.source_tariff_lines SET default_price_majore = 138.0300
WHERE source = 'police_saisie' AND kind = 'SERV-PEC' AND effective_from = '2025-01-01';

UPDATE public.source_tariff_lines SET default_price_majore = 2.3428
WHERE source = 'police_saisie' AND kind = 'SERV-KM' AND effective_from = '2025-01-01';

NOTIFY pgrst, 'reload schema';

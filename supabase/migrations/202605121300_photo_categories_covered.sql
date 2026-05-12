-- ============================================================
-- Driver app — persistance catégories photos couvertes
-- ============================================================
-- Bug identifie 12/05/2026 sur le wrapper iOS : le tracker "telle
-- categorie est faite" etait stocke en localStorage local au device,
-- donc invisible entre PC / iPhone / wrapper / autres devices.
--
-- Fix : persiste les categories couvertes en BDD (tableau text[]) pour
-- que le suivi soit partage cross-device.
--
-- Categories possibles (cf PHOTO_CATS dans DriverClient.tsx) :
-- plaque, avant, arriere (requis), gauche, droite, interieur, defauts,
-- vin, km, autre.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS photo_categories_covered text[] DEFAULT '{}';

COMMENT ON COLUMN public.incoming_missions.photo_categories_covered IS
  'Categories du wizard photos qui ont au moins 1 photo prise. Partage cross-device.';

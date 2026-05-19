-- ============================================================
-- 202605191500_parc_rows_int_fix
-- ============================================================
-- Fix : la fonction reorder_parc_rows() ajoute un offset 100000
-- aux row_number temporairement pour eviter les conflits UNIQUE.
-- Avec la colonne en SMALLINT (max 32767), ca declenche "smallint
-- out of range". On passe la colonne en INTEGER.
--
-- Idem incoming_missions.parc_row_number qui doit pouvoir contenir
-- la meme valeur (lien semantique).
-- ============================================================

ALTER TABLE public.parc_rows
  ALTER COLUMN row_number TYPE INTEGER;

ALTER TABLE public.incoming_missions
  ALTER COLUMN parc_row_number TYPE INTEGER;

ALTER TABLE public.incoming_missions
  ALTER COLUMN parc_slot_index TYPE INTEGER;

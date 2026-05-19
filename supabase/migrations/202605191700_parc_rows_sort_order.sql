-- ============================================================
-- 202605191700_parc_rows_sort_order
-- ============================================================
-- Decouple l ordre d affichage du row_number (label) :
-- - row_number   : identifiant fige (label A1, A2, ...). Ne change
--                  jamais sur drag&drop, ainsi les missions restent
--                  attachees a leur rangee physique.
-- - sort_order   : ordre d affichage (admin + plan). Modifie par
--                  drag&drop dans /admin/parc.
--
-- On reecrit reorder_parc_rows pour ne plus toucher au row_number
-- ni aux incoming_missions : un simple UPDATE du sort_order suffit.
-- ============================================================

ALTER TABLE public.parc_rows
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Initialisation : sort_order = row_number pour les lignes existantes
UPDATE public.parc_rows SET sort_order = row_number WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_parc_rows_zone_sort
  ON public.parc_rows(zone_key, sort_order);

-- Reecrit la fonction reorder : ne touche que sort_order. Pas de cascade
-- sur les missions, pas de renumerotation row_number.
CREATE OR REPLACE FUNCTION public.reorder_parc_rows(
  p_zone_key    TEXT,
  p_ordered_ids BIGINT[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id  BIGINT;
  v_idx INTEGER := 0;
BEGIN
  FOREACH v_id IN ARRAY p_ordered_ids LOOP
    v_idx := v_idx + 1;
    UPDATE public.parc_rows
    SET sort_order = v_idx, updated_at = now()
    WHERE id = v_id AND zone_key = p_zone_key;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_parc_rows TO service_role;

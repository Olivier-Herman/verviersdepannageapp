-- ============================================================
-- 202605191400_reorder_parc_rows
-- ============================================================
-- Fonction SQL atomique pour reorganiser l ordre des lignes
-- d une zone via drag&drop dans /admin/parc.
--
-- Probleme : UNIQUE(zone_key, row_number) empeche les swaps
-- directs. La fonction passe par un offset temporaire (100000)
-- pour eviter les conflits, et synchronise les missions
-- (incoming_missions.parc_row_number) dans le meme mouvement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reorder_parc_rows(
  p_zone_key    TEXT,
  p_ordered_ids BIGINT[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_temp_offset INTEGER := 100000;
  v_id          BIGINT;
  v_idx         INTEGER := 0;
  v_old_num     INTEGER;
BEGIN
  -- Phase 1 : offset temporaire de toutes les lignes de la zone
  UPDATE public.parc_rows
  SET row_number = row_number + v_temp_offset
  WHERE zone_key = p_zone_key;

  -- Phase 2 : pour chaque id dans l ordre fourni, recuperer son ancien
  -- numero (= valeur + offset), reaffecter les missions concernees au
  -- nouveau numero, puis fixer le nouveau row_number sur la ligne
  FOREACH v_id IN ARRAY p_ordered_ids LOOP
    v_idx := v_idx + 1;

    SELECT row_number INTO v_old_num FROM public.parc_rows WHERE id = v_id;
    -- v_old_num = ancien_row_number + 100000

    -- Mettre a jour les missions qui pointaient sur l ancien numero
    UPDATE public.incoming_missions
    SET parc_row_number = v_idx
    WHERE parc_zone_key  = p_zone_key
      AND parc_row_number = v_old_num - v_temp_offset;

    -- Mettre a jour la ligne vers son nouveau numero
    UPDATE public.parc_rows
    SET row_number = v_idx, updated_at = now()
    WHERE id = v_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_parc_rows TO service_role;

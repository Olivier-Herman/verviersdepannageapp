-- ============================================================
-- 202605191900_inventaire_parc_tracking
-- ============================================================
-- Inventaire fourriere : tracking spatial (rangee + slot) pendant
-- le scan, plus liaison vers incoming_missions pour calculer les
-- "manquants" a la fin de l inventaire.
--
-- Sur inventaire_sessions :
--   - parc_zone_key, parc_row_number, next_slot_index : etat de
--     l avancement (rangee courante + prochain slot).
-- Sur inventaire_session_items :
--   - parc_zone_key, parc_row_number, parc_slot_index : ou la
--     voiture a ete placee lors du scan.
--   - incoming_mission_id : lien vers la mission VD Soft (si on
--     l a trouvee via plaque/external_id). Permet de calculer
--     missing = parc_zone_key=X AND id NOT IN (scanned ids).
--   - transferred_from_zone/row/slot : capture l ancien placement
--     si le vehicule etait deja sur le plan ailleurs (utile pour
--     l export "transfert").
-- ============================================================

ALTER TABLE public.inventaire_sessions
  ADD COLUMN IF NOT EXISTS parc_zone_key    TEXT,
  ADD COLUMN IF NOT EXISTS parc_row_number  INTEGER,
  ADD COLUMN IF NOT EXISTS next_slot_index  INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.inventaire_session_items
  ADD COLUMN IF NOT EXISTS parc_zone_key            TEXT,
  ADD COLUMN IF NOT EXISTS parc_row_number          INTEGER,
  ADD COLUMN IF NOT EXISTS parc_slot_index          INTEGER,
  ADD COLUMN IF NOT EXISTS incoming_mission_id      UUID,
  ADD COLUMN IF NOT EXISTS transferred_from_zone    TEXT,
  ADD COLUMN IF NOT EXISTS transferred_from_row     INTEGER,
  ADD COLUMN IF NOT EXISTS transferred_from_slot    INTEGER;

-- Index pour calculer rapidement "items scannes par session + mission_id"
CREATE INDEX IF NOT EXISTS idx_inventaire_items_session_mission
  ON public.inventaire_session_items(session_id, incoming_mission_id)
  WHERE incoming_mission_id IS NOT NULL;

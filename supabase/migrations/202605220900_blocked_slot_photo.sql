-- ============================================================
-- 202605220900_blocked_slot_photo
-- ============================================================
-- Permet d associer une photo a un slot bloque pendant l inventaire :
-- cas du vehicule physiquement present sans etiquette, on photographie
-- pour pouvoir identifier ulterieurement (re-etiquetage ou retrait).
--
-- Champs ajoutes a parc_blocked_slots :
--   - photo_url    : URL Supabase Storage de la photo du vehicule sans etiquette
--   - blocked_kind : 'manual' (defaut) | 'missing_label' (depuis inventaire)
--     Sert a filtrer/styliser les slots bloques en mode "Debloquer" pour
--     differencier les blocages volontaires (panne sol, reserves) des
--     vehicules sans etiquette a re-etiqueter.
-- ============================================================

ALTER TABLE public.parc_blocked_slots
  ADD COLUMN IF NOT EXISTS photo_url    TEXT,
  ADD COLUMN IF NOT EXISTS blocked_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (blocked_kind IN ('manual', 'missing_label'));

COMMENT ON COLUMN public.parc_blocked_slots.photo_url IS
  'URL Supabase Storage de la photo du vehicule sans etiquette (uniquement pour blocked_kind = missing_label).';
COMMENT ON COLUMN public.parc_blocked_slots.blocked_kind IS
  'Type de blocage : manual (par defaut) ou missing_label (vehicule sans etiquette pendant inventaire).';

CREATE INDEX IF NOT EXISTS idx_parc_blocked_slots_kind
  ON public.parc_blocked_slots (blocked_kind)
  WHERE blocked_kind = 'missing_label';

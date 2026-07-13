-- Marqueur « OCR VIN/plaque déjà tenté » sur la fiche : borne l'usage IA à UNE
-- tentative par fiche (le superadmin peut outrepasser). Olivier 2026-07-13.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS vehicle_ocr_attempted_at timestamptz;

NOTIFY pgrst, 'reload schema';

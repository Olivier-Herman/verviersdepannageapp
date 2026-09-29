-- Rapport client : lieu de la signature = position du téléphone au moment où la
-- personne signe (Olivier 29/09/2026), avec son adresse lue par Google (navigateur).
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS signer_lat   double precision,
  ADD COLUMN IF NOT EXISTS signer_lng   double precision,
  ADD COLUMN IF NOT EXISTS signer_place text;
NOTIFY pgrst, 'reload schema';

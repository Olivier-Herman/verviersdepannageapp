-- Marqueur de demande de VR Touring : évite une seconde demande (Touring n'en
-- accorde qu'un par dossier) et sert de départ à la chasse au lieu du VR.
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS touring_vr_requested_at timestamptz;
NOTIFY pgrst, 'reload schema';

-- Relevé commune (Olivier 11/11/2026) : une épave issue d'une réquisition AVP
-- (y compris une mal garée passée en AVP) doit figurer dans le relevé envoyé à
-- la commune, QUELLE QUE SOIT la porte de mise en épave. Une épave d'accident,
-- ou un véhicule dont le client a signé l'abandon (abandon du client, pas
-- abandon voie publique), n'y va pas. Pas de rattrapage : à partir d'aujourd'hui.
--   releve_commune_attente_at : mis en épave hors de l'écran du relevé → à déclarer
--   releve_commune_envoye_at  : inclus dans un relevé envoyé à la commune
ALTER TABLE public.incoming_missions ADD COLUMN IF NOT EXISTS releve_commune_attente_at timestamptz;
ALTER TABLE public.incoming_missions ADD COLUMN IF NOT EXISTS releve_commune_envoye_at  timestamptz;
CREATE INDEX IF NOT EXISTS incoming_missions_releve_commune_attente_idx
  ON public.incoming_missions (releve_commune_attente_at) WHERE releve_commune_attente_at IS NOT NULL AND releve_commune_envoye_at IS NULL;

NOTIFY pgrst, 'reload schema';

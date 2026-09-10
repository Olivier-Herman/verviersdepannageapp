-- Olivier 10/09/2026 : « le type de gardiennage d'un Siabis couvert (assistance) doit être
-- Assistance et non Siabis. Le type Siabis est uniquement pour les SNC. »
CREATE OR REPLACE FUNCTION dossier_gardiennage_regime(p_source text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_source = 'police_saisie'                                        THEN 'saisie'
    -- Siabis = NON couvert uniquement (police_snc et alias) ; un Siabis couvert est
    -- une assistance (Touring paie) → régime assistance. Olivier 10/09/2026.
    WHEN p_source IN ('sia_noncouvert', 'siabis', 'police_snc')            THEN 'siabis'
    WHEN p_source LIKE 'police_%' OR p_source LIKE 'garage%' OR p_source LIKE 'legacy_%'
      OR p_source IN ('prive', 'fourriere_parc', 'francofolies', 'gardiennage', 'unknown', 'circuit', 'pv_assistance')
                                                                           THEN 'autre'
    ELSE 'assistance'
  END
$$;

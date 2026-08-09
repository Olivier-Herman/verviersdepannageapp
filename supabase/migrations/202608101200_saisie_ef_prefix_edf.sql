-- 202608101200_saisie_ef_prefix_edf
--
-- Le n° d'état de frais utilise le préfixe EDF- (État De Frais), conforme à la
-- maquette validée (ex : EDF-2026-0428). Olivier 2026-08-10.

CREATE OR REPLACE FUNCTION next_saisie_ef_number(p_year int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE seq int;
BEGIN
  INSERT INTO saisie_ef_counter(year, last_seq) VALUES (p_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = saisie_ef_counter.last_seq + 1
    RETURNING last_seq INTO seq;
  RETURN 'EDF-' || p_year::text || '-' || lpad(seq::text, 4, '0');
END;
$$;

NOTIFY pgrst, 'reload schema';

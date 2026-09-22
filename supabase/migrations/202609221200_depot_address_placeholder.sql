-- Olivier 22/09/2026 (2GLN102) : « Choix du client – Keuze » (Touring), « à
-- définir », « à confirmer »… tiennent lieu d'adresse sans en être une. Pas
-- d'arrêt du gardiennage dessus (même test que les dépôts).
CREATE OR REPLACE FUNCTION dossier_is_depot_address(p_addr text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_a text;
  v_d record;
  v_street text;
BEGIN
  v_a := lower(translate(COALESCE(p_addr, ''), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'));
  v_a := btrim(regexp_replace(v_a, '[^a-z0-9]+', ' ', 'g'));
  IF v_a = '' THEN RETURN true; END IF;
  IF v_a LIKE '%choix du client%' OR v_a LIKE '%keuze%' OR v_a LIKE '%a definir%' OR v_a LIKE '%a confirmer%'
     OR v_a LIKE '%a preciser%' OR v_a LIKE '%inconnu%' OR v_a LIKE '%non communique%' OR v_a LIKE '%en attente%' THEN RETURN true; END IF;
  IF v_a LIKE '%verviers depannage%' THEN RETURN true; END IF;
  IF v_a LIKE '%lefin%' AND v_a LIKE '%pepinster%' THEN RETURN true; END IF;
  FOR v_d IN SELECT address FROM depots WHERE COALESCE(active, true) LOOP
    v_street := lower(translate(COALESCE(v_d.address, ''), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'));
    v_street := btrim(regexp_replace(v_street, '[^a-z0-9]+', ' ', 'g'));
    v_street := btrim(regexp_replace(v_street, '^((\S+\s+){1,3}\S+).*$', '\1'));
    IF length(v_street) >= 8 AND (v_a LIKE '%' || v_street || '%' OR v_street LIKE '%' || v_a || '%') THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Surcharges — renommer 'accident_police' → 'appel_police_accident'
-- ============================================================
-- Le seed initial creait un client 'accident_police' (libelle 'Accident Police'),
-- la detection se basait sur un boolean is_police_call sur la mission. On a
-- simplifie : la grille s'appelle maintenant 'Appel Police - Accident' et
-- elle est cibilee comme n'importe quelle source de mission (le dispatcher
-- selectionne la source au moment de la creation, ou elle vient d'un partner
-- Odoo lie a mission_sources).
--
-- Met a jour la cle + le libelle pour preserver les schedules eventuellement
-- deja configures dessus (CASCADE FK).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.surcharge_clients WHERE key = 'accident_police')
  AND NOT EXISTS (SELECT 1 FROM public.surcharge_clients WHERE key = 'appel_police_accident') THEN
    UPDATE public.surcharge_clients
       SET key   = 'appel_police_accident',
           label = 'Appel Police - Accident',
           kind  = 'assistance'
     WHERE key = 'accident_police';
  ELSIF NOT EXISTS (SELECT 1 FROM public.surcharge_clients WHERE key = 'appel_police_accident') THEN
    -- ni l'ancien ni le nouveau n'existent : insere proprement
    INSERT INTO public.surcharge_clients (key, label, kind, sort_order)
    VALUES ('appel_police_accident', 'Appel Police - Accident', 'assistance', 10);
  END IF;
END $$;

-- La colonne incoming_missions.is_police_call devient inutile. On la garde
-- pour ne pas casser d'eventuelles fiches deja sauvees, mais elle n'est plus
-- lue par le code.
COMMENT ON COLUMN public.incoming_missions.is_police_call IS
  'DEPRECATED — plus utilise depuis 2026-05-13, conserve pour compat. La detection police passe par source = appel_police_accident.';

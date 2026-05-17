-- ============================================================
-- SEED Apple Review : compte demo + missions test
-- ============================================================
-- A executer dans Supabase Studio quand on prepare la soumission App Store.
-- Idempotent : peut etre re-execute sans casser.
--
-- Compte utilise par Apple reviewer pour tester l app sans Azure AD :
--   - Email    : applereview@verviersdepannage.com
--   - Password : !Verviers4800 (hash bcrypt via pgcrypto)
--   - Role     : dispatcher (acces complet aux workflows sans modifier la prod)
--
-- Donne acces a 5 missions demo couvrant les statuts principaux :
--   1. En commande (new)        - DEMO-001
--   2. En attente (dispatching) - DEMO-002
--   3. Assignee (assigned)      - DEMO-003 (assignee a applereview)
--   4. En cours (in_progress)   - DEMO-004 (assignee a applereview, photos)
--   5. Terminee (to_invoice)    - DEMO-005 (cloturee, decharge signee)
-- ============================================================

-- 1. Set password_hash bcrypt sur applereview + rôle dispatcher + actif
UPDATE public.users
SET
  password_hash  = crypt('!Verviers4800', gen_salt('bf', 12)),
  role           = 'dispatcher',
  roles          = ARRAY['dispatcher'],
  active         = true,
  auth_provider  = COALESCE(auth_provider, 'email_password')
WHERE email = 'applereview@verviersdepannage.com';

-- 2. Lien credentials dans user_auth_providers (idempotent)
INSERT INTO public.user_auth_providers (user_id, provider, provider_account_id, provider_email)
SELECT id, 'credentials', LOWER(email), LOWER(email)
FROM public.users
WHERE email = 'applereview@verviersdepannage.com'
ON CONFLICT (provider, provider_account_id) DO NOTHING;

-- 3. Récupérer l'id du user pour les missions
DO $$
DECLARE
  v_user_id UUID;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE email = 'applereview@verviersdepannage.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User applereview@verviersdepannage.com introuvable - cree-le d abord';
  END IF;

  -- ── Mission 1 : EN COMMANDE (statut new) ─────────────────────────────
  INSERT INTO public.incoming_missions (
    external_id, dossier_number, source, mission_type,
    client_name, client_phone,
    vehicle_plate, vehicle_brand, vehicle_model,
    incident_address, incident_city, incident_country,
    incident_lat, incident_lng,
    destination_address, destination_name,
    amount_to_collect, status, received_at, intervention_date,
    raw_content
  ) VALUES (
    'DEMO-001', 'DEMO-001', 'vab', 'remorquage',
    'Client Démo VAB', '+32 471 00 00 01',
    '1DEMO01', 'TOYOTA', 'Yaris',
    'Avenue Reine Astrid 5', 'Spa', 'Belgium',
    50.4928, 5.8616,
    'Garage Demo SA, Rue de la Paix 12, 4900 Spa', 'Garage Demo SA',
    0, 'new', v_now, v_now,
    '[Demo data] Mission VAB demo pour Apple Review'
  ) ON CONFLICT DO NOTHING;

  -- ── Mission 2 : EN ATTENTE (dispatching, geocodee) ────────────────────
  INSERT INTO public.incoming_missions (
    external_id, dossier_number, source, mission_type,
    client_name, client_phone,
    vehicle_plate, vehicle_brand, vehicle_model,
    incident_address, incident_city, incident_country,
    incident_lat, incident_lng,
    destination_address,
    amount_to_collect, status, received_at, intervention_date,
    raw_content
  ) VALUES (
    'DEMO-002', 'DEMO-002', 'touring', 'depannage',
    'Client Démo Touring', '+32 471 00 00 02',
    '2DEMO02', 'VOLKSWAGEN', 'Golf',
    'Rue du Centenaire 23', 'Verviers', 'Belgium',
    50.5910, 5.8627,
    NULL,
    50.00, 'dispatching', v_now, v_now,
    '[Demo data] Mission Touring depannage sur place'
  ) ON CONFLICT DO NOTHING;

  -- ── Mission 3 : ASSIGNEE (assigned to applereview) ────────────────────
  INSERT INTO public.incoming_missions (
    external_id, dossier_number, source, mission_type,
    client_name, client_phone,
    vehicle_plate, vehicle_brand, vehicle_model,
    incident_address, incident_city, incident_country,
    incident_lat, incident_lng,
    destination_address,
    amount_to_collect, status,
    received_at, intervention_date, assigned_at, assigned_to,
    raw_content
  ) VALUES (
    'DEMO-003', 'DEMO-003', 'ima', 'remorquage',
    'Client Démo IMA', '+32 471 00 00 03',
    '3DEMO03', 'BMW', 'Serie 3',
    'Boulevard Frère Orban 11', 'Liège', 'Belgium',
    50.6296, 5.5797,
    'Garage BMW Liège, Avenue du Pont 5, 4020 Liège',
    0, 'assigned',
    v_now, v_now, v_now, v_user_id,
    '[Demo data] Mission IMA assignee au compte review'
  ) ON CONFLICT DO NOTHING;

  -- ── Mission 4 : EN COURS (in_progress, accepted + on_way) ─────────────
  INSERT INTO public.incoming_missions (
    external_id, dossier_number, source, mission_type,
    client_name, client_phone,
    vehicle_plate, vehicle_brand, vehicle_model,
    incident_address, incident_city, incident_country,
    incident_lat, incident_lng,
    destination_address,
    amount_to_collect, status,
    received_at, intervention_date,
    assigned_at, assigned_to, accepted_at, on_way_at, on_site_at,
    raw_content
  ) VALUES (
    'DEMO-004', 'DEMO-004', 'mondial', 'depannage',
    'Client Démo Mondial', '+32 471 00 00 04',
    '4DEMO04', 'PEUGEOT', '208',
    'Place du Marché 1', 'Verviers', 'Belgium',
    50.5891, 5.8650,
    NULL,
    75.00, 'in_progress',
    v_now - INTERVAL '30 minutes', v_now - INTERVAL '30 minutes',
    v_now - INTERVAL '25 minutes', v_user_id,
    v_now - INTERVAL '20 minutes',
    v_now - INTERVAL '15 minutes',
    v_now - INTERVAL '5 minutes',
    '[Demo data] Mission Mondial en cours, chauffeur sur place'
  ) ON CONFLICT DO NOTHING;

  -- ── Mission 5 : TERMINEE (to_invoice avec decharge signee) ────────────
  INSERT INTO public.incoming_missions (
    external_id, dossier_number, source, mission_type,
    client_name, client_phone,
    vehicle_plate, vehicle_brand, vehicle_model,
    incident_address, incident_city, incident_country,
    incident_lat, incident_lng,
    destination_address,
    amount_to_collect, payment_collected_at, payment_mode, payment_amount,
    status,
    received_at, intervention_date,
    assigned_at, assigned_to, accepted_at, on_way_at, on_site_at, completed_at,
    discharge_data,
    raw_content
  ) VALUES (
    'DEMO-005', 'DEMO-005', 'ethias', 'depannage',
    'Client Démo Ethias', '+32 471 00 00 05',
    '5DEMO05', 'RENAULT', 'Clio',
    'Rue Xhavée 8', 'Verviers', 'Belgium',
    50.5868, 5.8629,
    NULL,
    35.00, v_now - INTERVAL '1 hour', 'cash', 35.00,
    'to_invoice',
    v_now - INTERVAL '3 hours', v_now - INTERVAL '3 hours',
    v_now - INTERVAL '2 hours 30 minutes', v_user_id,
    v_now - INTERVAL '2 hours 20 minutes',
    v_now - INTERVAL '2 hours 10 minutes',
    v_now - INTERVAL '1 hour 50 minutes',
    v_now - INTERVAL '1 hour',
    '[{"type_key":"fin_intervention_sans_degats","name":"Client Démo Ethias","sig":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAUCAYAAAB7wJiVAAAAAXNSR0IArs4c6QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAGNJREFUSEvtl8EJADAIA9X9d3aLU2gpodK87fwQjzPkmCSdMrJjvCWfqU0SmnLT2WTwGBhDQfBwBoIfBfBYwAU8B+E/zP6BHwsAvAY8AaiBwBjsB4D8B8AcAfwHID8DwH8ARkHwAwI+gn8eUEW5JAAAAABJRU5ErkJggg==","created_at":"' || (v_now - INTERVAL '1 hour')::TEXT || '"}]'::jsonb,
    '[Demo data] Mission Ethias terminee avec encaissement cash 35 EUR + decharge fin intervention'
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE '✅ Seed Apple Review applique : 5 missions DEMO-001 a DEMO-005 creees pour user_id %', v_user_id;
END $$;

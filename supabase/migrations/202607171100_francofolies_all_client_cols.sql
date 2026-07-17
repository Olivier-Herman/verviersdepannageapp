-- Fix DÉFINITIF module Francofolies : la route pickup écrit un jeu complet de
-- champs client_* sur incoming_missions (name/phone/email/address/city/vat), mais
-- ces colonnes n'existaient pas toutes (elles vivent nativement sur la table
-- `interventions`, pas `incoming_missions`). PostgREST ne signale qu'UNE colonne
-- manquante à la fois → on les corrigeait au compte-gouttes (client_city, puis
-- client_email…). On les ajoute TOUTES ici, idempotent (no-op si déjà présentes).
-- Olivier 2026-07-17.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS client_name    text,
  ADD COLUMN IF NOT EXISTS client_phone   text,
  ADD COLUMN IF NOT EXISTS client_email   text,
  ADD COLUMN IF NOT EXISTS client_address text,
  ADD COLUMN IF NOT EXISTS client_city    text,
  ADD COLUMN IF NOT EXISTS client_vat     text;

-- Indispensable : sans reload, PostgREST garde l'ancien cache et rejette encore.
NOTIFY pgrst, 'reload schema';

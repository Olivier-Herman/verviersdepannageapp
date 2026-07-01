-- 202607011300_kaze_cancelled_after_accept.sql
-- Annulation Kaze APRÈS acceptation chauffeur = trajet à vide à facturer.
-- Olivier 2026-07-01. Cf [[project_kaze_annulation_deplacement_vide]].
--
-- Quand Kaze annule une mission déjà acceptée par le chauffeur (accepted /
-- in_progress / delivering), on NE la fait PAS disparaître : on la garde visible
-- dans le dispatch, on la bascule en mission_type='trajet_vide' (facturation d'un
-- trajet à vide) et on lève ce flag pour l'affichage (badge dispatch + chauffeur).

alter table public.incoming_missions
  add column if not exists kaze_cancelled_after_accept boolean not null default false;

comment on column public.incoming_missions.kaze_cancelled_after_accept is
  'Kaze a annulé la mission alors que le chauffeur avait déjà accepté → trajet à vide à facturer, mission gardée visible.';

-- Recharger le cache PostgREST (sinon la colonne est ignorée à l''INSERT/UPDATE via API).
notify pgrst, 'reload schema';

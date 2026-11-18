-- Assistance qui reprend la relivraison, choisie avec l'adresse (Olivier 18/11/2026, 1YAT978 : « reprise par AXA » encodé
-- avec l'adresse, mais perdu tant que la relivraison n'était pas créée). Utilisée à la création de la relivraison.
alter table public.incoming_missions add column if not exists redelivery_source text;
comment on column public.incoming_missions.redelivery_source is 'Source (assistance) qui reprend la relivraison, choisie avec l''adresse ; reprise à la création de la REL';
notify pgrst, 'reload schema';

-- Instructions au chauffeur et tarif imposé de la relivraison, gardés avec l'adresse (Olivier 18/11/2026) : ils se
-- perdaient avec « Enregistrer » tant que la relivraison n'était pas créée. Repris à la création de la REL.
alter table public.incoming_missions add column if not exists redelivery_driver_comments text;
alter table public.incoming_missions add column if not exists redelivery_imposed_htva numeric;
comment on column public.incoming_missions.redelivery_driver_comments is 'Instructions au chauffeur (une par ligne) pour la relivraison à venir ; reprises à la création de la REL';
comment on column public.incoming_missions.redelivery_imposed_htva is 'Tarif HTVA imposé pour la relivraison à venir (vide = calcul habituel) ; repris à la création de la REL';
notify pgrst, 'reload schema';

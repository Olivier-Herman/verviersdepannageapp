-- Taux de majoration accordé sur une fiche (Olivier 17/11/2026, 1KJP382 : Momo accorde 50 % au lieu de 100 %).
-- Remplace le taux de la plage horaire quand une majoration s'applique ; null = taux de la grille.
alter table public.incoming_missions add column if not exists surcharge_pct_override numeric;
comment on column public.incoming_missions.surcharge_pct_override is 'Taux de majoration accordé sur cette fiche (remplace le taux de la plage horaire), null = grille';
notify pgrst, 'reload schema';

-- Majorations Eurocross (Olivier 16/10/2026) : Eurocross n'était pas un client du module Majorations, le calcul
-- retombait sur les plages « SNC » (0 %) — remorquage du samedi 01/08/2026 (GT052B, NL5950869) estimé sans
-- supplément. Grille Eurocross Belgique 2026 : suppléments 18 h – 7 h, week-end et jours fériés (un férié suit
-- le dimanche) : +45 % réparation sur place, +35 % dépannage/remorquage.
insert into public.surcharge_clients (key, label, kind, sort_order, active)
values ('eurocross', 'Eurocross', 'assistance', 0, true)
on conflict (key) do nothing;

insert into public.surcharge_schedules (client_key, weekday, hour_start, hour_end, rate_dsp_pct, rate_rem_pct)
select 'eurocross', w, h.s, h.e, 45, 35
from generate_series(1, 5) as w
cross join (values (0, 7), (18, 24)) as h(s, e)
where not exists (select 1 from public.surcharge_schedules where client_key = 'eurocross');

insert into public.surcharge_schedules (client_key, weekday, hour_start, hour_end, rate_dsp_pct, rate_rem_pct)
select 'eurocross', w, 0, 24, 45, 35
from generate_series(6, 7) as w
where not exists (select 1 from public.surcharge_schedules where client_key = 'eurocross' and weekday in (6, 7));

notify pgrst, 'reload schema';

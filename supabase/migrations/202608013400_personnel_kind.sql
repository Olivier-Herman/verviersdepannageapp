-- Personnel indépendant (sous-traitant) : distinct du personnel interne.
-- Les indépendants n'ont pas de fiche de paie ni de feuille de présence ;
-- ils utilisent uniquement le module Congés (et peuvent imposer leur congé).
-- Appliqué en live le 2026-08-01.

alter table personnel add column if not exists kind text not null default 'interne';   -- 'interne' | 'independant'

-- Indépendants initiaux (liés à leur compte pour le suivi des congés).
insert into personnel (name, name_key, kind, user_id, active, poste)
values
  ('HERMAN Olivier', 'herman olivier', 'independant', '29df3445-f452-4ebc-a7bb-c16a8377289b', true, 'Indépendant'),
  ('VIVIAN', 'vivian', 'independant', '8a927fee-cdde-420b-a466-9d5d8c129838', true, 'Indépendant')
on conflict do nothing;

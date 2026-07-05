-- Véhicule roulant / non roulant, choisi obligatoirement par le chauffeur à la
-- mise en parc (demande Axel 2026-07-05). Affiché sur la fiche.
--   true  = roulant
--   false = non roulant
--   null  = non renseigné (anciennes fiches / mise en parc forcée par le dispatch)
alter table public.incoming_missions
  add column if not exists is_rollable boolean;

notify pgrst, 'reload schema';

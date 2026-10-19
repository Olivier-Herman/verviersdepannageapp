-- Siabis+ : suppléments techniques et frais complémentaires cochés sur la fiche (grue, absorbant, supplément
-- horaire…), repris tout seuls dans l'estimation et la facturation (Olivier 19/10/2026, mission 10195398).
alter table public.incoming_missions add column if not exists snc_supplements jsonb;
comment on column public.incoming_missions.snc_supplements is
  'Siabis+ : suppléments cochés sur la fiche, ex. {"grue":1,"absorbant":2,"horaire":3} ; prix HTVA = réglages siabis_sup_*.';

-- Prix HTVA de la grille officielle Siabis+ (SPW / SOFICO / Police fédérale)
insert into public.app_settings (key, value) values
  ('siabis_sup_grue', '74'),
  ('siabis_sup_anneau', '16.5'),
  ('siabis_sup_roue', '25'),
  ('siabis_sup_cles', '25'),
  ('siabis_sup_batterie', '16.5'),
  ('siabis_sup_absorbant', '21'),
  ('siabis_sup_adapte', '20'),
  ('siabis_sup_adapte_maj', '30'),
  ('siabis_sup_horaire', '21.5'),
  ('siabis_sup_horaire_maj', '32'),
  ('siabis_sup_taxi', '54')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

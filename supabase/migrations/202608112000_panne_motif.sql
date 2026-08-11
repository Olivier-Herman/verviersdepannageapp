-- Motif de panne relevé par le chauffeur, côté VD SOFT (Olivier 2026-08-11).
--
-- Pour Touring/VAB il alimente les codes de l'assisteur ; pour Kaze, Allianz et le
-- privé il n'y a AUCUN référentiel externe — la valeur reste chez nous : elle
-- documente la fiche, sert au dispatch et à la facturation, et n'est jamais
-- poussée dehors.
alter table public.incoming_missions
  add column if not exists panne_motif       text,
  add column if not exists panne_motif_label text;

comment on column public.incoming_missions.panne_motif is
  'Clé du motif de panne choisi à la clôture (catalogue interne, flux 2)';
comment on column public.incoming_missions.panne_motif_label is
  'Libellé lisible du motif de panne — affichage dispatch / facturation';

notify pgrst, 'reload schema';

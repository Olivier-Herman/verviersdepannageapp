-- Mémorise TOUS les AssignmentId VAB rattachés à une fiche (pas seulement
-- l'external_id de la 1re action). Une nouvelle action VAB sur un dossier déjà
-- présent (relivraison, dépannage requalifié en remorquage) enrichit la fiche
-- existante ; sans mémoriser son AssignmentId, le preview d'import la reproposait
-- en boucle « à importer » (Olivier 2026-07-06).
alter table public.incoming_missions
  add column if not exists vab_assignment_ids text[] not null default '{}';

create index if not exists idx_incoming_missions_vab_aids
  on public.incoming_missions using gin (vab_assignment_ids);

notify pgrst, 'reload schema';

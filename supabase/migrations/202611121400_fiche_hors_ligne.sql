-- Fiche hors ligne (Olivier 12/11/2026, après la panne Orange du 11/11) :
-- le chauffeur crée sa fiche sans réseau, elle est envoyée au retour du réseau.
-- offline_id : identifiant donné par le téléphone, pour ne jamais créer deux fois la même fiche.
-- offline_created_at : moment où le chauffeur a enregistré la fiche dans le téléphone.
alter table public.incoming_missions
  add column if not exists offline_id text,
  add column if not exists offline_created_at timestamptz;

create unique index if not exists incoming_missions_offline_id_key
  on public.incoming_missions (offline_id)
  where offline_id is not null;

notify pgrst, 'reload schema';

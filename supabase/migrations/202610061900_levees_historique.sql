-- Levées de saisie : historique par fiche + alarme fourrière (Olivier 06/10/2026).
--
-- Une fiche peut recevoir au plus deux levées : une TEMPORAIRE puis une DÉFINITIVE.
-- Les colonnes levee_saisie_* de incoming_missions gardent la DERNIÈRE levée (elles
-- pilotent le gardiennage) ; cette table garde chaque levée, pour que la définitive
-- n'efface plus la temporaire (date, document, qui, comment).

create table if not exists mission_levees (
  id           uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references incoming_missions(id) on delete cascade,
  levee_type   text not null check (levee_type in ('temporaire', 'definitive')),
  levee_date   date,
  doc_path     text,
  intake_id    uuid,
  autorite     text,
  mode         text not null default 'manuel' check (mode in ('auto', 'manuel', 'reprise')),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists mission_levees_mission on mission_levees (mission_id, created_at);

alter table mission_levees disable row level security;
grant all on mission_levees to service_role;

-- Reprise : la levée déjà enregistrée sur chaque fiche devient sa première ligne d'historique.
insert into mission_levees (mission_id, levee_type, levee_date, doc_path, autorite, mode, created_by, created_at)
select id, coalesce(nullif(levee_saisie_type, ''), 'definitive'), levee_saisie_date, levee_saisie_doc_path, levee_saisie_note, 'reprise', levee_saisie_by, levee_saisie_at
from incoming_missions m
where levee_saisie_at is not null
  and coalesce(nullif(levee_saisie_type, ''), 'definitive') in ('temporaire', 'definitive')
  and not exists (select 1 from mission_levees l where l.mission_id = m.id);

-- Comptes qui ne reçoivent jamais l'alarme fourrière (compte de démonstration pour Apple).
insert into app_settings (key, value) values
  ('fourriere_alarme_exclus_user_ids', '["b6630a88-8fdf-490a-9bd2-9b4d6507f128"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- Bouton « En appel » sur la fiche (Olivier 24/11/2026) : pendant un appel, l'agent note le motif sur la fiche. Le
-- numéro arrive tout de suite si Teams l'a transmis au décroché (appel_ouvertures, page /appel), sinon au relevé
-- suivant (environ 30 min) : l'appel où l'agent était en ligne à ce moment-là est rattaché à la fiche, son numéro retenu
-- et recopié comme téléphone du client si la fiche n'en a pas.

create table if not exists appel_notes (
  id         uuid primary key default gen_random_uuid(),
  mission_id uuid not null references incoming_missions(id) on delete cascade,
  user_id    uuid not null,
  at         timestamptz not null default now(),
  motif      text,
  texte      text,
  numero     text,
  appel_id   text references supervision_appels(id) on delete set null,
  complete_at timestamptz
);
create index if not exists appel_notes_mission on appel_notes (mission_id);
create index if not exists appel_notes_a_completer on appel_notes (at) where appel_id is null;
alter table appel_notes disable row level security;
grant all on appel_notes to service_role;

-- Numéros transmis par Teams au décroché (page /appel), par personne.
create table if not exists appel_ouvertures (
  id      bigserial primary key,
  user_id uuid not null,
  numero  text not null,
  at      timestamptz not null default now()
);
create index if not exists appel_ouvertures_user on appel_ouvertures (user_id, at desc);
alter table appel_ouvertures disable row level security;
grant all on appel_ouvertures to service_role;
grant usage, select on sequence appel_ouvertures_id_seq to service_role;

-- Comptes Teams → comptes VD Soft (pour retrouver l'appel d'un agent). Mobi et Olivier Herman = la même personne.
insert into app_settings (key, value, updated_at) values ('appels_comptes_vdsoft', '{
  "Mobi - VD": ["29df3445-f452-4ebc-a7bb-c16a8377289b", "fd345b74-539b-466b-9b64-19d168f561d4"],
  "Olivier Herman": ["29df3445-f452-4ebc-a7bb-c16a8377289b", "fd345b74-539b-466b-9b64-19d168f561d4"],
  "Momo - VD": ["e7cbab7f-1d0a-4109-ab60-7b223d088b57", "1b628f46-44ef-4a89-bdd7-a648e03f2154"],
  "Momo Bureau VD": ["e7cbab7f-1d0a-4109-ab60-7b223d088b57", "1b628f46-44ef-4a89-bdd7-a648e03f2154"],
  "Jonathan - VD": ["eda29707-c9c7-47b5-ab21-084ea22201bc"],
  "Axel Bureau VD": ["c4044c9d-24f4-4083-aa82-0e490a97194f"],
  "Matthieu - VD": ["de1c6853-fd3c-47fc-b755-82c5b13b0322"]
}', now())
on conflict (key) do nothing;

-- Motifs rapides du bouton « En appel » (réglage métier, groupe Dispatch).
insert into app_settings (key, value, updated_at) values ('appels_motifs',
  '["Nouvelles du dépannage", "Rendez-vous de restitution", "Paiement / facture", "Garage", "Assistance", "Police", "Documents", "Réclamation"]', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';

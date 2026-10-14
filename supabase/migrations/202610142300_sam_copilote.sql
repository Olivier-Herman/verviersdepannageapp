-- Sam copilote du chauffeur (Olivier 14/10/2026) : Sam détecte ce qui va bloquer le chauffeur sur sa mission
-- (adresse non reconnue, Siabis sans scénario, montant à encaisser manquant, chargé sans arrivée) et lui
-- écrit le premier, avec les choix en boutons. Une ligne par problème et par mission (jamais deux fois).
create table if not exists public.sam_alertes (
  id                   bigserial primary key,
  mission_id           uuid not null references public.incoming_missions(id) on delete cascade,
  user_id              uuid not null references public.users(id) on delete cascade,
  kind                 text not null,
  agent                text,
  texte                text not null,
  boutons              jsonb not null default '[]'::jsonb,
  donnees              jsonb,
  conversation_id      uuid,
  created_at           timestamptz not null default now(),
  answered_at          timestamptz,
  answer               text,
  resolved_at          timestamptz,
  dispatch_notified_at timestamptz,
  unique (mission_id, kind)
);
create index if not exists sam_alertes_user_idx on public.sam_alertes (user_id, created_at desc);
alter table public.sam_alertes disable row level security;
grant all on public.sam_alertes to service_role;
grant usage, select on sequence public.sam_alertes_id_seq to service_role;

insert into public.app_settings (key, value)
values ('sam_copilote_pas_arrive_min', '90')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

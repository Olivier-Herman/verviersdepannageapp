-- Appels rattachés aux fiches (Olivier 24/11/2026). Quand un agent décroche, Teams ouvre /appel?tel=… : la fiche du
-- numéro s'ouvre (ou un choix, ou une recherche) et le numéro est retenu pour cette fiche. Toutes les 15 minutes, les
-- appels relevés chez Microsoft (supervision_appels) se rattachent tout seuls quand le numéro désigne une seule fiche ;
-- les autres attendent sur l'écran « Appels à rattacher ». Numéros comparés sur leurs 8 derniers chiffres
-- (+32 87 60 06 09 = 087 60 06 09) ; Microsoft masque la fin des numéros appelés (« ***»), comparés par motif.

create table if not exists appel_fiches (
  appel_id   text primary key references supervision_appels(id) on delete cascade,
  mission_id uuid references incoming_missions(id) on delete cascade,   -- null = « pas lié à une fiche »
  mode       text not null check (mode in ('auto', 'retenu', 'manuel', 'pas_lie')),
  par        uuid,                                                         -- null = rattaché tout seul
  at         timestamptz not null default now()
);
create index if not exists appel_fiches_mission on appel_fiches (mission_id);
alter table appel_fiches disable row level security;
grant all on appel_fiches to service_role;

create table if not exists fiche_numeros (
  numero8    text not null,
  mission_id uuid not null references incoming_missions(id) on delete cascade,
  numero     text,                -- tel qu'il est arrivé, pour l'affichage
  par        uuid,
  at         timestamptz not null default now(),
  primary key (numero8, mission_id)
);
alter table fiche_numeros disable row level security;
grant all on fiche_numeros to service_role;

-- Fiches dont un numéro (client, assuré, client d'origine, ou numéro retenu) finit par le motif (8 caractères, « _ » = chiffre masqué).
create or replace function fiches_par_numero(motif text)
returns table (mission_id uuid, retenu boolean, retenu_at timestamptz)
language sql stable as $$
  select id, false, null::timestamptz from incoming_missions
   where right(regexp_replace(coalesce(client_phone, ''), '\D', '', 'g'), 8) like motif
      or right(regexp_replace(coalesce(assisted_phone, ''), '\D', '', 'g'), 8) like motif
      or right(regexp_replace(coalesce(origin_client_phone, ''), '\D', '', 'g'), 8) like motif
  union all
  select mission_id, true, at from fiche_numeros where numero8 like motif
$$;
grant execute on function fiches_par_numero(text) to service_role;

notify pgrst, 'reload schema';

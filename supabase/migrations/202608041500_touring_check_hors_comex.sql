-- « Check Touring » : file des dossiers Touring HORS COMEX à faire trancher par
-- Touring via un lien public stable. Touring répond (semi : superadmin applique).

create table if not exists public.touring_check_dossiers (
  id               uuid primary key default gen_random_uuid(),
  root_mission_id  uuid not null unique references public.incoming_missions(id) on delete cascade,
  dossier_number   text,
  intervention_date timestamptz,
  fiches           jsonb not null default '[]'::jsonb,   -- [{mission_id,kind,plate,brand,model,incident,destination,mission_type}]
  is_combined      boolean not null default false,
  status           text not null default 'pending',      -- pending | answered | applied | dismissed
  response_code    text,                                  -- already_invoiced | not_covered | invoice_hors_comex | deplacement_hors_comex | other
  response_note    text,                                  -- n° accord ou texte libre
  answered_at      timestamptz,
  applied_at       timestamptz,
  applied_by       uuid,
  applied_result   text,
  created_at       timestamptz not null default now(),
  refreshed_at     timestamptz not null default now()
);
create index if not exists idx_tcd_status on public.touring_check_dossiers(status);
create index if not exists idx_tcd_dossier on public.touring_check_dossiers(dossier_number);

alter table public.touring_check_dossiers enable row level security;
grant all on table public.touring_check_dossiers to service_role, postgres;

-- Tampon visible en facturation quand Touring dit « à facturer hors comex (combiné) »
-- ou « autre / à vérifier ».
alter table public.incoming_missions add column if not exists touring_check_stamp text;

-- Jeton stable du lien public Touring (app_settings.value = TEXTE JSON).
insert into public.app_settings (key, value)
values ('touring_check_token', to_jsonb(replace(gen_random_uuid()::text,'-',''))::text)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

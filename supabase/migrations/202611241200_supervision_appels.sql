-- Suivi du bureau : appels de la téléphonie Teams (Olivier 24/11/2026). Microsoft ne garde le journal que 30 jours :
-- chaque passage de 21 h enregistre ici les appels des 26 dernières heures. Cf src/lib/supervision/appels.ts.
create table if not exists public.supervision_appels (
  id             text primary key,            -- id de l'appel chez Microsoft (« pstn:… » pour un appel émis)
  debut          timestamptz not null,
  fin            timestamptz,
  sens           text not null check (sens in ('entrant', 'sortant', 'interne')),
  service        text,                        -- service atteint (Dépannage Service, Rent a car…) ou « Centrale »
  numero         text,                        -- numéro extérieur (appelant ou appelé)
  parts          jsonb not null default '[]', -- personnes en ligne dans l'ordre : [{nom, qui, debut, sec}]
  decroche_par   text,
  attente_s      int,
  perdu          boolean not null default false,
  renvoi_externe boolean not null default false,
  releve_at      timestamptz not null default now()
);
create index if not exists supervision_appels_debut on public.supervision_appels (debut);
alter table public.supervision_appels disable row level security;
grant all on public.supervision_appels to service_role;

-- Correspondances des comptes Teams (relevées sur les appels du 24/11/2026). Un standard absent de la liste
-- (Administratif, Francofolies) s'affiche sous son nom Teams. CP Recycling : autre société, exclu.
update app_settings set value = (value::jsonb || '{
  "appels": {
    "comptes": {"Momo - VD": "Momo", "Momo Bureau VD": "Momo", "Jonathan - VD": "Jona", "Mobi - VD": "Mobi", "Olivier Herman": "Mobi", "Axel Bureau VD": "Axel", "Matthieu - VD": "Matthieu"},
    "services": {"Dépannage Service - VD": "Dépannage Service", "VD - Fourriere SA": "Fourrière service", "Fourrière Service - VD": "Fourrière service", "VD - RAC SA": "Rent a car", "Rent A Car - VD": "Rent a car", "VD - Suivi Dépannage SA": "Suivi dépannage"},
    "centrale": ["Verviers Dépannage"],
    "robots": ["Verviers Dispatch Calling Bot"],
    "exclus": ["CP Recycling", "Car Parts Recycling"],
    "seuil_s": 3
  },
  "poids_appels_note": "appel_recu 1, appel_emis 1, appel_interne 0 (modifiables dans poids)"
}'::jsonb)::text, updated_at = now()
where key = 'supervision_config';
update app_settings set value = jsonb_set(value::jsonb, '{poids}', (value::jsonb -> 'poids') || '{"appel_recu": 1, "appel_emis": 1, "appel_interne": 0}'::jsonb)::text
where key = 'supervision_config';

notify pgrst, 'reload schema';

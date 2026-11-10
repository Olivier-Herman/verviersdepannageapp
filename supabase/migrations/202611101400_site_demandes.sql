-- Demandes reçues par le site public (lot 1, maquette validée le 10/11/2026).
--   · rappel      : « Rappelez-moi » — un GSM, rappel promis sous N heures ouvrables ;
--   · candidature : chauffeur-dépanneur — permis, expérience, CV facultatif.
-- Elles arrivent dans l'écran /admin/demandes-site ET par mail (destinataires en
-- réglages). Une seule table : le bureau voit tout au même endroit.

create table if not exists public.site_requests (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('rappel', 'candidature')),
  created_at   timestamptz not null default now(),
  name         text,
  phone        text,
  email        text,
  lang         text not null default 'fr',
  details      jsonb not null default '{}'::jsonb,   -- motif, permis, expérience, message…
  file_path    text,                                 -- CV dans le stockage « site-demandes »
  file_name    text,
  due_at       timestamptz,                          -- échéance promise (rappel)
  status       text not null default 'nouveau' check (status in ('nouveau', 'traite')),
  handled_at   timestamptz,
  handled_by   uuid,
  handled_note text,
  ip           text
);
create index if not exists idx_site_requests_status on public.site_requests (status, created_at desc);

alter table public.site_requests enable row level security;
grant all on public.site_requests to service_role;

-- CV des candidatures : stockage privé, lu par lien signé depuis l'écran.
insert into storage.buckets (id, name, public)
values ('site-demandes', 'site-demandes', false)
on conflict (id) do nothing;

-- Réglages (app_settings.value = texte JSON), modifiables dans /admin/settings.
insert into app_settings (key, value, updated_at) values ('site_rappel_destinataires', '["info@verviersdepannage.be"]', now()) on conflict (key) do nothing;
insert into app_settings (key, value, updated_at) values ('site_candidature_destinataires', '["mobi@verviersdepannage.be", "momo@verviersdepannage.be"]', now()) on conflict (key) do nothing;
insert into app_settings (key, value, updated_at) values ('site_delai_rappel_heures', '48', now()) on conflict (key) do nothing;
insert into app_settings (key, value, updated_at) values ('site_delai_devis_heures', '24', now()) on conflict (key) do nothing;
insert into app_settings (key, value, updated_at) values ('site_heures_bureau', '"1-5 08:00-18:00"', now()) on conflict (key) do nothing;
insert into app_settings (key, value, updated_at) values ('site_recrutement_actif', '"oui"', now()) on conflict (key) do nothing;

notify pgrst, 'reload schema';

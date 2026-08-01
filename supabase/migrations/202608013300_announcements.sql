-- Module Annonces : nouveautés poussées aux travailleurs (in-app + push natif/web)
-- avec suivi de lecture (qui a vu la news). Appliqué en live le 2026-08-01.

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  emoji text not null default '✨',
  title text not null,
  body text not null,
  action_url text not null default '/ma-paie',
  cta_label text not null default 'Découvrir',
  active boolean not null default true,
  target text not null default 'workers',   -- workers = users liés à un personnel
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- Accès serveur uniquement (API routes via service_role, qui contourne la RLS).
alter table announcements enable row level security;
alter table announcement_reads enable row level security;

insert into announcements (key, emoji, title, body, action_url, cta_label)
values ('mes_prestations', '✨', 'Ton espace « Mes Prestations » est arrivé !',
  'Tes fiches de paie, tes congés et tes infos personnelles sont désormais réunis au même endroit, rien que pour toi. Demande un congé en 2 clics, garde tes infos à jour, retrouve toutes tes fiches par année.',
  '/ma-paie', 'Découvrir mon espace')
on conflict (key) do nothing;

-- Notifications Telegram de Mobi retenues hors de ses heures « Verviers Dépannage » (Olivier 24/10/2026 :
-- « en dehors de ces heures-là je ne prends que les notifs urgentes »). Envoyées au début du créneau suivant.
create table if not exists public.telegram_differes (
  id         bigserial primary key,
  chat_id    bigint not null,
  texte      text not null,
  rows       jsonb not null default '[]'::jsonb,
  expediteur text,
  created_at timestamptz not null default now()
);
alter table public.telegram_differes enable row level security;
grant all on public.telegram_differes to service_role;
grant usage, select on sequence public.telegram_differes_id_seq to service_role;
notify pgrst, 'reload schema';

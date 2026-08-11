-- File d'attente des clôtures d'assistance (Olivier 2026-08-11).
--
-- PRINCIPE : une application TIERCE ne doit JAMAIS bloquer le chauffeur. Quand la
-- plateforme de l'assistance est injoignable (COMEX en panne pendant le 1er test
-- de Franck), on n'affiche pas une erreur et on ne fait pas attendre : on
-- MÉMORISE la clôture demandée, le chauffeur termine sa mission normalement, et
-- un cron REJOUE la clôture dès que la plateforme répond à nouveau.
--
-- Idempotence : avant de rejouer, le worker relit le statut chez l'assistance —
-- si le dossier est déjà clôturé (à la main par le dispatch, ou par un essai
-- précédent dont on n'a pas vu la réponse), la ligne passe en 'done' sans
-- renvoyer quoi que ce soit.

create table if not exists public.assistance_close_queue (
  id           uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references public.incoming_missions(id) on delete cascade,
  assistance   text not null,                    -- 'touring' | 'vab' | 'kaze'
  payload      jsonb not null,                   -- entrée de la transformation (issue, motif, codes…)
  status       text not null default 'pending'   check (status in ('pending','done','failed','abandoned')),
  attempts     int  not null default 0,
  last_error   text,
  last_try_at  timestamptz,
  done_at      timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists assistance_close_queue_pending_idx
  on public.assistance_close_queue (status, created_at)
  where status = 'pending';
create index if not exists assistance_close_queue_mission_idx
  on public.assistance_close_queue (mission_id);

-- Table serveur-only (écrite/lue via service_role, qui contourne RLS).
alter table public.assistance_close_queue enable row level security;
grant all on public.assistance_close_queue to service_role;

notify pgrst, 'reload schema';

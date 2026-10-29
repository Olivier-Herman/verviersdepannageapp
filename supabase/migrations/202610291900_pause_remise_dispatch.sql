-- Pause « remise au dispatch » (Olivier 29/10/2026, maquette https://claude.ai/artifact/R3DmoG4dm8AsSUEEZ2qxuf validée).
-- Le chauffeur qui met en pause peut rendre la mission au dispatch : elle quitte ses missions (assigned_to = null,
-- statut 'dispatching'), reste marquée en pause (paused_at / pause_until / pause_reason) et tout chauffeur peut la
-- reprendre depuis « Missions en pause ». On garde qui l'a remise, quand, et le statut qu'elle avait.
alter table public.incoming_missions
  add column if not exists pause_released_at  timestamptz,
  add column if not exists pause_released_by  uuid references public.users(id) on delete set null,
  add column if not exists pause_prev_status  text;

create index if not exists incoming_missions_pause_released_idx
  on public.incoming_missions (pause_released_at) where pause_released_at is not null;

notify pgrst, 'reload schema';

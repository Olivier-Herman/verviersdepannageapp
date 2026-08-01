-- Annonces : diffusion programmée + choix des destinataires. Live le 2026-08-01.

alter table announcements
  add column if not exists scheduled_at   timestamptz,        -- diffusion auto à cette date/heure (cron)
  add column if not exists broadcast_at   timestamptz,        -- date de diffusion effective (null = pas encore)
  add column if not exists audience       text not null default 'all',        -- 'all' | 'custom'
  add column if not exists target_user_ids uuid[] not null default '{}';       -- si audience='custom'

notify pgrst, 'reload schema';

-- Alertes de panne des tâches planifiées (Olivier 06/10/2026) : une seule alerte par
-- panne, réservée par une écriture atomique, et un seul message « rétabli ».
create table if not exists cron_alerts (
  key           text primary key,
  failing_since timestamptz not null default now(),
  last_error    text,
  alerted_at    timestamptz
);
alter table cron_alerts disable row level security;
grant all on cron_alerts to service_role;
notify pgrst, 'reload schema';

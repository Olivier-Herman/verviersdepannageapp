-- Statut de présence MANUEL « Hors ligne » du user (toggle dispatch).
-- « On base le ok notif sur le statut » — Olivier 2026-08-09.
-- Remplace le stockage temporaire jsonb notif_preferences.presence_offline
-- (déploiement e5bb221d) par une vraie colonne dédiée.

alter table public.users
  add column if not exists manual_offline boolean not null default false;

comment on column public.users.manual_offline is
  'Statut de présence manuel : true = Hors ligne (plus de notifs opérationnelles, pas « vert » au dispatch). Réglé via /api/users/presence.';

-- Reprise de l''état posé en jsonb pendant le déploiement transitoire.
update public.users
   set manual_offline = true
 where coalesce((notif_preferences->>'presence_offline')::boolean, false) = true;

update public.users
   set notif_preferences = notif_preferences - 'presence_offline'
 where notif_preferences ? 'presence_offline';

-- Recharge le cache de schéma PostgREST (sinon INSERT/SELECT sur la colonne KO).
notify pgrst, 'reload schema';

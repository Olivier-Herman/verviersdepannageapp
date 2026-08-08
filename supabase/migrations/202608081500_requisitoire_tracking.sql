-- Module « Relance réquisitoire » (fourrière / saisie).
--
-- Se GREFFE sur le système réquisitoire existant : « reçu » = requisitoire_at
-- IS NOT NULL (déjà posé par POST /api/missions/[id]/requisitoire, upload dans
-- le bucket mission-remarks). On n'ajoute ICI que le SUIVI DE RELANCE :
-- lien public de dépôt (token) + arrêt manuel + horodatage/compteur de relances.
-- Statut dérivé : reçu si requisitoire_at, stop si requisitoire_stop, sinon attendu.
-- Olivier 2026-08-08.

alter table public.incoming_missions
  add column if not exists requisitoire_token           text,        -- token du lien public de dépôt
  add column if not exists requisitoire_stop            boolean not null default false, -- « Stop rappel réquisitoire »
  add column if not exists requisitoire_last_reminder_at timestamptz, -- dernier mail de relance envoyé
  add column if not exists requisitoire_reminder_count  int not null default 0; -- nombre de relances envoyées

create unique index if not exists idx_incoming_missions_requisitoire_token
  on public.incoming_missions (requisitoire_token) where requisitoire_token is not null;

notify pgrst, 'reload schema';

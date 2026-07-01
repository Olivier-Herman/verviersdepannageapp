-- 202607011200_requisitoire_intake.sql
-- File d'attente des réquisitoires capturés automatiquement dans la boîte
-- fourriere@verviersdepannage.be. Olivier 2026-07-01.
--
-- Flux : cron poll fourriere@ → Claude lit la PJ PDF → extrait plaque/VIN/PV/
-- adresse/date/modèle → matching multi-signal sur incoming_missions → ligne
-- ici en statut 'pending'. Un humain rattache à la bonne fiche (Option A :
-- aucune annexion auto au démarrage). À l'annexion : PDF rattaché + n° PV
-- concaténé au dossier_number (jamais écrasé).
--
-- Table SERVEUR-ONLY : accédée uniquement via API (service_role). RLS ENABLE
-- (le service_role la contourne), pas d'accès anon.

create table if not exists public.requisitoire_intake (
  id                 uuid primary key default gen_random_uuid(),
  mailbox            text not null,                       -- boîte source (fourriere@…)
  source_email_id    text not null,                       -- Graph message id (dedup)
  from_addr          text,                                -- expéditeur (plusieurs zones police)
  subject            text,
  received_at        timestamptz,
  file_name          text,                                -- nom PJ d'origine
  doc_path           text,                                -- chemin dans bucket 'mission-remarks' (_intake/…)
  extracted          jsonb,                               -- {is_requisitoire, pv_number, plaque, vin, marque, modele, adresse, date_requisition, autorite, raw_quote}
  candidates         jsonb   not null default '[]'::jsonb, -- [{mission_id, mission_number, score, reasons[]}]
  matched_mission_id uuid    references public.incoming_missions(id),
  confidence         text,                                -- 'high' | 'low' | 'none'
  status             text    not null default 'pending',  -- pending | attached | ignored | not_requisitoire | error
  error              text,
  attached_at        timestamptz,
  attached_by        uuid    references public.users(id),
  created_at         timestamptz not null default now()
);

-- Dedup : un email source ne crée qu'une ligne (évite de re-payer l'appel Claude).
create unique index if not exists requisitoire_intake_email_uniq
  on public.requisitoire_intake (source_email_id);

create index if not exists requisitoire_intake_status_idx
  on public.requisitoire_intake (status, created_at desc);

alter table public.requisitoire_intake enable row level security;

-- Recharger le cache PostgREST (sinon INSERT/SELECT via API échouent en 'schema cache').
notify pgrst, 'reload schema';

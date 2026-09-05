-- 202609051200_exit_control
--
-- CONTRÔLE DE SORTIE des épaves gérées par un bureau d'expertise.
-- Olivier 2026-09-05, après le vol d'une épave rendue sans vérification du
-- bon Informex : dès qu'un expert a vu un véhicule Police – Accident, la
-- sortie du parc est bloquée tant que la checklist n'est pas complète
-- (chemin choisi, bon Informex décodé, identité lue et concordante, CMR si
-- transporteur, attestation signée). Sortie forcée = motif + PIN personnel.
--
-- Trois tables serveur-only (service_role) :
--   mission_exit_control  1 ligne par fiche armée (checklist + instantanés)
--   mission_documents     pièces capturées (photo ID, CMR, bon Informex, signature)
--   capture_tokens        QR affiché sur la fiche → capture depuis le téléphone

create table if not exists public.mission_exit_control (
  mission_id            uuid primary key references public.incoming_missions(id) on delete cascade,
  armed_at              timestamptz not null default now(),
  armed_by_visit_id     uuid references public.mission_visitors(id) on delete set null,
  expert_bureau         text,

  -- Chemin de sortie : 'informex' | 'autre' | 'assistance'
  path                  text check (path in ('informex', 'autre', 'assistance')),
  path_destination      text,
  path_chosen_at        timestamptz,
  path_chosen_by_kind   text,          -- 'bureau' | 'expert' | 'staff'
  path_chosen_by_name   text,          -- interlocuteur au bureau / prénom expert
  path_chosen_by_user   uuid references public.users(id),
  path_note             text,
  assistance_mission_id uuid references public.incoming_missions(id) on delete set null,

  -- Bon Informex
  informex_qr_raw       text,
  informex_qr_at        timestamptz,
  informex_qr_by        uuid references public.users(id),
  informex_doc          jsonb,         -- lecture du bon (acheteur, plaque, châssis, référence…)
  informex_match        jsonb,         -- { plate: bool|null, vin: bool|null }

  -- Personne présente
  identity              jsonb,         -- mêmes clés que la lecture eID + source 'eid'|'ocr'|'manual'
  identity_at           timestamptz,
  identity_by           uuid references public.users(id),
  identity_role         text check (identity_role in ('buyer', 'mandate', 'transporter')),
  mandate_note          text,
  company               jsonb,         -- { name, vat, vies_ok, truck_plate }

  -- CMR (transporteur)
  cmr                   jsonb,
  cmr_at                timestamptz,
  cmr_by                uuid references public.users(id),

  -- Attestation d'enlèvement (instantané figé + signature)
  attestation           jsonb,
  attestation_signed_at timestamptz,
  attestation_signature_path text,
  attestation_by        uuid references public.users(id),

  -- Sortie forcée (motif + PIN personnel)
  forced_at             timestamptz,
  forced_by             uuid references public.users(id),
  forced_reason         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.mission_documents (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references public.incoming_missions(id) on delete cascade,
  kind          text not null,       -- 'id_card' | 'cmr' | 'informex' | 'truck' | 'signature'
  file_path     text not null,
  file_name     text,
  mime_type     text,
  file_size     integer,
  ocr           jsonb,
  qr_raw        text,
  capture_token uuid,
  uploaded_by   uuid references public.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_mission_documents_mission on public.mission_documents (mission_id, created_at desc);

create table if not exists public.capture_tokens (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references public.incoming_missions(id) on delete cascade,
  kind        text not null,         -- 'id_card' | 'cmr' | 'informex' | 'signature'
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists idx_capture_tokens_mission on public.capture_tokens (mission_id, created_at desc);

-- Tables serveur-only : lues/écrites via les routes API en service_role
-- (service_role contourne la RLS). On ENABLE sans policy, comme les visites.
alter table public.mission_exit_control enable row level security;
alter table public.mission_documents    enable row level security;
alter table public.capture_tokens       enable row level security;

-- Bucket Storage privé (l'app fournit des signed URLs via API)
insert into storage.buckets (id, name, public)
values ('mission-documents', 'mission-documents', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

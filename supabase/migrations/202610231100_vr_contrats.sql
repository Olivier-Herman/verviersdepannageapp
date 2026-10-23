-- Contrat « véhicule de remplacement » VAB (Olivier 23/10/2026, maquette https://claude.ai/artifact/1VLFohCUhrUgshm43vPEJo).
-- Le chauffeur affiche un QR (lien /vr/<id>) ; le client photographie carte d'identité et permis (recto/verso),
-- vérifie ses informations (lues sur les documents), donne son adresse (Google, découpée comme dans Comet) et
-- signe sur son téléphone. En même temps, le chauffeur note l'état du véhicule prêté (propreté intérieure et
-- extérieure, kilométrage, carburant 0/25/50/75/100 %). Tout reste chez nous ; la clôture Comet viendra ensuite.
create table if not exists public.vr_contrats (
  id            uuid primary key default gen_random_uuid(),   -- = jeton du lien client
  mission_id    uuid not null references public.incoming_missions(id) on delete cascade,
  status        text not null default 'ouvert',               -- ouvert | client_ok | signe | complet
  lang          text not null default 'fr',
  client        jsonb not null default '{}'::jsonb,           -- nom, prenom, naissance, carte_id, permis, email, tel, langue, adresse{pays,cp,ville,rue,numero,boite}
  ocr           jsonb not null default '{}'::jsonb,           -- lecture brute des documents
  photos        jsonb not null default '{}'::jsonb,           -- id_recto, id_verso, permis_recto, permis_verso → chemin dans mission-documents
  signature_path text,
  signed_at     timestamptz,
  vehicule      jsonb not null default '{}'::jsonb,           -- proprete_int, proprete_ext, km, carburant
  created_by    uuid,
  expires_at    timestamptz not null default (now() + interval '2 hours'),
  completed_at  timestamptz,
  comet_status  text,                                         -- null | a_envoyer | envoye | erreur
  comet_error   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vr_contrats_mission_idx on public.vr_contrats(mission_id);
alter table public.vr_contrats disable row level security;
grant all on public.vr_contrats to service_role;
notify pgrst, 'reload schema';

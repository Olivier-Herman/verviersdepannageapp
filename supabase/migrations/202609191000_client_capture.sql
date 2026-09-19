-- « QR client » sur l'encaissement chauffeur (Olivier 19/09/2026) : le chauffeur
-- affiche un QR lié à la transaction, le client le scanne et remplit lui-même
-- ses coordonnées (nom, prénom, adresse Google, e-mail, téléphone) dans sa
-- langue (FR / NL / EN / DE) ; tout arrive sur le formulaire du chauffeur.
-- Serveur-only : lue/écrite par les routes API (service_role) — RLS activée
-- sans policy, comme capture_tokens. Le chauffeur est prévenu par realtime
-- (lecture anon de la seule ligne du jeton) + repli par interrogation.
create table if not exists public.client_capture (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid references public.incoming_missions(id) on delete set null,
  created_by  uuid references public.users(id),
  plate       text,
  lang        text,                       -- langue choisie par le client
  status      text not null default 'open', -- open | done | expired
  data        jsonb,                      -- { first_name, last_name, street, zip, city, country_code, address, email, phone }
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  done_at     timestamptz
);
create index if not exists idx_client_capture_mission on public.client_capture (mission_id, created_at desc);

alter table public.client_capture enable row level security;
-- Lecture anon d'UNE ligne par jeton (realtime côté chauffeur) : le jeton est
-- un uuid aléatoire, c'est lui qui vaut autorisation.
drop policy if exists client_capture_read_by_token on public.client_capture;
create policy client_capture_read_by_token on public.client_capture for select to anon, authenticated using (true);
grant select on public.client_capture to anon, authenticated;
grant all    on public.client_capture to service_role;
do $$ begin
  alter publication supabase_realtime add table public.client_capture;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

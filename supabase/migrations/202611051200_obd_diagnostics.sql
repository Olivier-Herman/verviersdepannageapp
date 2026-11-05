-- Diagnostic OBD (Olivier 05/11/2026, maquette https://claude.ai/artifact/F1KAFhsPsLkFqvgZvQS8oS validée).
-- Une fiche de diagnostic par lecture : depuis une mission (mission_id) ou seule (hors intervention),
-- identifiée par le VIN. Les codes sont enregistrés AVANT tout effacement ; l'effacement est signé par PIN.
create sequence if not exists public.obd_diagnostic_seq;
create table if not exists public.obd_diagnostics (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique default ('D-' || lpad(nextval('public.obd_diagnostic_seq')::text, 4, '0')),
  mission_id    uuid references public.incoming_missions(id) on delete set null,
  vin           text,
  vin_source    text check (vin_source in ('obd','photo','saisie')),
  plate         text,
  vehicle       jsonb,          -- { marque, modele, motorisation, annee }
  codes         jsonb not null default '[]'::jsonb,   -- [{ code, type: 'memorise'|'en_attente' }]
  measures      jsonb not null default '{}'::jsonb,   -- { batterie_v, temp_moteur_c, regime_tr_min, temoin_moteur, nb_codes }
  analysis      jsonb,          -- avis de Sam : { verdict: 'dsp'|'rem'|'controle', fr: {...}, sq: {...} }
  adapter       text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  cleared_at    timestamptz,
  cleared_by    uuid,
  cleared_codes jsonb,
  clear_result  text check (clear_result in ('ok','refuse')),
  decision      text check (decision in ('dsp','rem')),
  attached_at   timestamptz,
  attached_by   uuid
);
create index if not exists obd_diagnostics_mission_idx on public.obd_diagnostics(mission_id);
create index if not exists obd_diagnostics_vin_idx on public.obd_diagnostics(vin);
alter table public.obd_diagnostics disable row level security;
grant all on public.obd_diagnostics to service_role;
grant usage, select on sequence public.obd_diagnostic_seq to service_role;
-- Préversion : Mobi, Olivier et Franck seulement (Olivier 05/11/2026).
insert into public.feature_flags (key, mode, label, pilot_user_ids)
values ('obd_diagnostic', 'off', 'Diagnostic OBD (préversion Mobi, Olivier, Franck)', array['29df3445-f452-4ebc-a7bb-c16a8377289b','fd345b74-539b-466b-9b64-19d168f561d4','de9a37aa-41b5-4a56-894b-cc304f601d1a']::uuid[])
on conflict (key) do nothing;
notify pgrst, 'reload schema';

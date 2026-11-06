-- Diagnostic OBD fiable (Olivier 06/11/2026, maquette https://claude.ai/artifact/UuHz6igEUsRhuvACf9hcjJ validée).
-- On garde les réponses brutes du boîtier, le protocole et l'état de la lecture : un code peut être revérifié après coup.
alter table public.obd_diagnostics
  add column if not exists protocol text,
  add column if not exists lecture  jsonb,   -- { complete, muette, manques[] }
  add column if not exists image_figee jsonb,   -- image figée au moment du défaut
  add column if not exists raw      jsonb;   -- [{ cmd, raw }]
alter table public.obd_diagnostics drop constraint if exists obd_diagnostics_clear_result_check;
alter table public.obd_diagnostics add constraint obd_diagnostics_clear_result_check
  check (clear_result in ('ok','refuse','partiel','lien_perdu','non_verifie'));

-- Définitions de référence des codes de panne. Sources : OBDex (CC0, codes génériques) et
-- dtc-database de Wal33D (licence MIT, Copyright (c) 2024 Waleed Judah : complément générique et codes constructeur).
create table if not exists public.obd_dtc_ref (
  code    text not null,
  marque  text not null,       -- GENERIQUE ou liste constructeur (VOLKSWAGEN, BMW…)
  libelle text not null,
  detail  text,                -- causes fréquentes, quand la source les donne
  source  text not null,
  primary key (code, marque)
);
alter table public.obd_dtc_ref disable row level security;
grant all on public.obd_dtc_ref to service_role;
notify pgrst, 'reload schema';

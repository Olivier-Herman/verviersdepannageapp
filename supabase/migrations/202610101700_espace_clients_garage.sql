-- Clients des garages (Olivier 10/10/2026, prototype validé) :
-- les clients d'un garage partenaire s'inscrivent par le QR code du garage et commandent eux-mêmes leur dépannage.
--   - option activée par le gestionnaire du garage (espace_societes.clients_actif) ;
--   - le garage classe chaque client : assistance (facturé au garage) ou pas (le client paie le chauffeur) ;
--   - sans assistance : source dédiée « <garage> clients », grille du garage majorée de 20 %,
--     déplacement pour rien 75 € TVAC ; commission de 15 % au garage par note de crédit mensuelle.

alter table espace_societes
  add column if not exists clients_actif       boolean not null default false,
  add column if not exists clients_slug        text,
  add column if not exists clients_source_key  text,
  add column if not exists clients_actif_par   text,
  add column if not exists clients_actif_le    timestamptz;
create unique index if not exists espace_societes_clients_slug on espace_societes (clients_slug) where clients_slug is not null;

create table if not exists espace_clients (
  id                 uuid primary key default gen_random_uuid(),
  societe_id         uuid not null references espace_societes(id) on delete cascade,
  prenom             text not null,
  nom                text not null,
  tel                text not null,
  email              text not null,
  adresse            text not null,
  plaque             text not null,
  marque             text,
  modele             text,
  assistance         boolean not null default false,
  assistance_par     text,
  assistance_le      timestamptz,
  verifie_le         timestamptz,
  odoo_partner_id    int,
  session_version    int not null default 1,
  active             boolean not null default true,
  derniere_connexion timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (societe_id, email)
);
create index if not exists espace_clients_societe on espace_clients (societe_id, created_at desc);

create table if not exists espace_client_codes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references espace_clients(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  tentatives  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists espace_client_codes_client on espace_client_codes (client_id, created_at desc);

alter table incoming_missions
  add column if not exists espace_client_id uuid references espace_clients(id) on delete set null;
create index if not exists incoming_missions_espace_client on incoming_missions (espace_client_id) where espace_client_id is not null;

alter table espace_clients      disable row level security;
alter table espace_client_codes disable row level security;
grant all on espace_clients, espace_client_codes to service_role;

-- ── Sources « clients » d'EBAC et de Centracar ─────────────────────────────────
-- Catalogue : copie de la source du garage ; le tag `encaissement_chauffeur` fait encaisser le chauffeur.
insert into mission_source_catalog (key, label, active, sort_order, default_billed_to_id, default_billed_to_name, display_color, apply_surcharges,
  default_depot_id, default_depot_name, default_parc_zone_key, skip_facturation, tags, label_encaissement)
select c.key || '_clients', c.label || ' clients', true, c.sort_order + 1, null, null, c.display_color, c.apply_surcharges,
  c.default_depot_id, c.default_depot_name, c.default_parc_zone_key, false, array['encaissement_chauffeur', 'client_garage'], 'Dépannage client ' || c.label
from mission_source_catalog c
where c.key in ('garage_4e50c4', 'garage_14528a')
on conflict (key) do nothing;

-- Grille : celle du garage, majorée de 20 % (prise en charge, km, gardiennage).
insert into source_tariffs (source, mission_type, unit_price, km_inclus, km_price, parc_day_price, surcharge_night_pct, surcharge_we_pct, surcharge_holiday_pct,
  conditions, is_autofac, effective_from, effective_to, notes, km_basis, pricing_mode, beyond_max_km, beyond_max_step_km, beyond_max_step_price, vehicle_class, rel_mode, rel_depart)
select t.source || '_clients', t.mission_type, round(t.unit_price * 1.2, 4), t.km_inclus, round(t.km_price * 1.2, 4), round(t.parc_day_price * 1.2, 4),
  t.surcharge_night_pct, t.surcharge_we_pct, t.surcharge_holiday_pct, t.conditions, false, date '2026-10-10', null,
  'Grille du garage majorée de 20 % (clients du garage sans assistance, Olivier 10/10/2026)', t.km_basis, t.pricing_mode,
  t.beyond_max_km, t.beyond_max_step_km, round(t.beyond_max_step_price * 1.2, 4), t.vehicle_class, t.rel_mode, t.rel_depart
from source_tariffs t
where t.source in ('garage_4e50c4', 'garage_14528a') and t.effective_to is null
  and not exists (select 1 from source_tariffs x where x.source = t.source || '_clients' and x.mission_type = t.mission_type);

-- Déplacement pour rien : forfait 75 € TVAC, sans km ni majoration (Olivier 10/10/2026).
insert into source_tariffs (source, mission_type, unit_price, km_inclus, km_price, surcharge_night_pct, surcharge_we_pct, surcharge_holiday_pct,
  is_autofac, effective_from, notes, km_basis, pricing_mode, rel_depart)
select s, 'trajet_vide', round(75 / 1.21, 4), 0, 0, 0, 0, 0, false, date '2026-10-10',
  'Déplacement pour rien : forfait 75 € TVAC, non commissionné au garage (Olivier 10/10/2026)', 'total', 'forfait', 'parc'
from unnest(array['garage_4e50c4_clients', 'garage_14528a_clients']) s
where not exists (select 1 from source_tariffs x where x.source = s and x.mission_type = 'trajet_vide');

-- Majorations horaires : les mêmes plages que le garage.
insert into surcharge_clients (key, label, kind, sort_order, active)
select c.key || '_clients', c.label || ' clients', c.kind, c.sort_order, c.active
from surcharge_clients c where c.key in ('garage_4e50c4', 'garage_14528a')
on conflict (key) do nothing;
insert into surcharge_schedules (client_key, weekday, hour_start, hour_end, rate_dsp_pct, rate_rem_pct)
select s.client_key || '_clients', s.weekday, s.hour_start, s.hour_end, s.rate_dsp_pct, s.rate_rem_pct
from surcharge_schedules s
where s.client_key in ('garage_4e50c4', 'garage_14528a')
  and not exists (select 1 from surcharge_schedules x where x.client_key = s.client_key || '_clients');

-- Lien public de chaque garage (option coupée tant que le gestionnaire ne l'active pas).
update espace_societes set clients_slug = 'ebac',      clients_source_key = 'garage_4e50c4_clients' where source_key = 'garage_4e50c4' and clients_slug is null;
update espace_societes set clients_slug = 'centracar', clients_source_key = 'garage_14528a_clients' where source_key = 'garage_14528a' and clients_slug is null;

notify pgrst, 'reload schema';

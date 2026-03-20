-- ============================================================
-- VERVIERS DÉPANNAGE — Schéma base de données
-- Migration 001 — Structure initiale
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "unaccent";

-- ============================================================
-- MODULES DISPONIBLES (référentiel)
-- ============================================================
create table public.modules (
  id          text primary key,           -- ex: 'encaissement', 'depose', etc.
  label       text not null,
  description text,
  icon        text,
  sort_order  integer default 0,
  active      boolean default true,
  created_at  timestamptz default now()
);

insert into public.modules (id, label, description, icon, sort_order) values
  ('encaissement',  'Encaissement Chauffeur',  'Enregistrement paiements clients',      '💳', 1),
  ('depose',        'Dépose Véhicule',          'Points de dépôt et contacts urgence',   '🗺️', 2),
  ('depannage',     'Service Dépannage',        'Interventions dépannage',               '🚗', 3),
  ('fourriere',     'Service Fourrière',        'Interventions fourrière',               '🚔', 4),
  ('rentacar',      'Service Rent A Car',       'Gestion véhicules de remplacement',     '🔑', 5),
  ('tgr',           'TGR Touring',              'Interventions TGR Touring',             '🛡️', 6),
  ('avance_fonds',  'Avance de Fonds',          'Lettres intra-comm + scan factures',    '📄', 7),
  ('documents',     'Documents',                'Docs chauffeur et fiches de paie',      '📁', 8),
  ('check_vehicle', 'Check Véhicule',           'Contrôle état véhicule',                '🔍', 9),
  ('admin',         'Administration',           'Gestion utilisateurs et paramètres',    '⚙️', 99);

-- ============================================================
-- UTILISATEURS (synchronisé depuis Azure AD via NextAuth)
-- ============================================================
create table public.users (
  id            uuid primary key default uuid_generate_v4(),
  azure_id      text unique,              -- Azure AD Object ID
  email         text unique not null,
  name          text,
  avatar_url    text,
  role          text not null default 'driver' check (role in ('driver', 'dispatcher', 'admin', 'superadmin')),
  phone         text,
  active        boolean default true,
  last_login    timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- PERMISSIONS UTILISATEUR PAR MODULE
-- ============================================================
create table public.user_modules (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  module_id   text not null references public.modules(id) on delete cascade,
  granted     boolean default true,
  granted_by  uuid references public.users(id),
  granted_at  timestamptz default now(),
  unique(user_id, module_id)
);

-- Index pour lookup rapide
create index idx_user_modules_user on public.user_modules(user_id);
create index idx_user_modules_module on public.user_modules(module_id);

-- ============================================================
-- MARQUES ET MODÈLES DE VÉHICULES
-- ============================================================
create table public.vehicle_brands (
  id    serial primary key,
  name  text not null unique,
  country text,
  active boolean default true
);

create table public.vehicle_models (
  id          serial primary key,
  brand_id    integer not null references public.vehicle_brands(id),
  name        text not null,
  category    text check (category in ('berline','break','suv','monospace','cabriolet','utilitaire','moto','camion','autre')),
  year_from   integer,
  year_to     integer,
  active      boolean default true,
  unique(brand_id, name)
);

create index idx_vehicle_models_brand on public.vehicle_models(brand_id);

-- ============================================================
-- LISTES PARAMÉTRABLES (backstage admin)
-- ============================================================
create table public.list_items (
  id          uuid primary key default uuid_generate_v4(),
  list_type   text not null,              -- 'motif', 'payment_mode', 'depose_reason', etc.
  value       text not null,
  label       text not null,
  sort_order  integer default 0,
  active      boolean default true,
  module_id   text references public.modules(id),
  created_by  uuid references public.users(id),
  created_at  timestamptz default now(),
  unique(list_type, value)
);

-- Données initiales — motifs
insert into public.list_items (list_type, value, label, sort_order, module_id) values
  ('motif', 'panne_moteur',    'Panne moteur',        1,  'encaissement'),
  ('motif', 'accident',        'Accident',            2,  'encaissement'),
  ('motif', 'pneu_creve',      'Pneu crevé',          3,  'encaissement'),
  ('motif', 'batterie',        'Batterie',            4,  'encaissement'),
  ('motif', 'fourriere',       'Fourrière',           5,  'encaissement'),
  ('motif', 'remorquage',      'Remorquage simple',   6,  'encaissement'),
  ('motif', 'panne_carbu',     'Panne de carburant',  7,  'encaissement'),
  ('motif', 'cle_perdue',      'Clé perdue/cassée',   8,  'encaissement'),
  ('motif', 'autre',           'Autre',               99, 'encaissement');

-- Données initiales — modes de paiement
insert into public.list_items (list_type, value, label, sort_order) values
  ('payment_mode', 'cash',       'Espèces',    1),
  ('payment_mode', 'bancontact', 'Bancontact', 2),
  ('payment_mode', 'virement',   'Virement',   3),
  ('payment_mode', 'cheque',     'Chèque',     4),
  ('payment_mode', 'assurance',  'Assurance',  5);

-- ============================================================
-- RACCOURCIS D'APPEL (configurables par admin)
-- ============================================================
create table public.call_shortcuts (
  id          uuid primary key default uuid_generate_v4(),
  label       text not null,
  phone       text not null,
  category    text check (category in ('assistance','police','prive','autre')),
  module_id   text references public.modules(id),
  sort_order  integer default 0,
  active      boolean default true,
  created_at  timestamptz default now()
);

insert into public.call_shortcuts (label, phone, category, module_id, sort_order) values
  ('Appel Assistance', '+3287123456', 'assistance', 'depose', 1),
  ('Appel Police',     '101',         'police',     'depose', 2),
  ('Appel Privé',      '+3287654321', 'prive',      'depose', 3);

-- ============================================================
-- INTERVENTIONS
-- ============================================================
create table public.interventions (
  id              uuid primary key default uuid_generate_v4(),
  reference       text unique,              -- générée automatiquement
  service_type    text not null check (service_type in ('depannage','fourriere','rentacar','tgr','encaissement')),
  driver_id       uuid references public.users(id),

  -- Véhicule
  plate           text,
  vin             text,
  brand_id        integer references public.vehicle_brands(id),
  model_id        integer references public.vehicle_models(id),
  brand_text      text,                     -- fallback si pas dans la liste
  model_text      text,

  -- Intervention
  motif_id        text,                     -- ref list_items.value
  motif_text      text,                     -- libellé au moment de la saisie
  location_address text,
  location_lat    decimal(10,7),
  location_lng    decimal(10,7),
  intervention_date timestamptz default now(),

  -- Paiement
  amount          decimal(10,2),
  payment_mode    text,
  payment_status  text default 'paid' check (payment_status in ('paid','pending','free')),

  -- Client
  client_vat      text,
  client_name     text,
  client_address  text,
  client_phone    text,
  client_email    text,

  -- Remarques & Odoo
  notes           text,
  odoo_invoice_id integer,                  -- ID facture Odoo si synchronisé
  odoo_partner_id integer,                  -- ID client Odoo
  synced_to_odoo  boolean default false,
  synced_at       timestamptz,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Génération automatique de référence : VD-2025-000001
create sequence intervention_seq start 1;
create or replace function generate_intervention_ref()
returns trigger as $$
begin
  new.reference := 'VD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('intervention_seq')::text, 6, '0');
  return new;
end;
$$ language plpgsql;

create trigger trg_intervention_ref
before insert on public.interventions
for each row execute function generate_intervention_ref();

-- ============================================================
-- DOCUMENTS CHAUFFEUR
-- ============================================================
create table public.driver_documents (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.users(id) on delete cascade,
  doc_type        text not null check (doc_type in ('permis','carte_id','certificat_medical','attestation','fiche_paie','autre')),
  label           text not null,
  file_path       text,                     -- path dans Supabase Storage
  expiry_date     date,
  issued_date     date,
  status          text default 'valid' check (status in ('valid','expiring','expired','pending')),
  uploaded_at     timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_driver_docs_user on public.driver_documents(user_id);

-- ============================================================
-- AVANCES DE FONDS
-- ============================================================
create table public.fund_advances (
  id              uuid primary key default uuid_generate_v4(),
  driver_id       uuid references public.users(id),
  invoice_file    text,                     -- path Supabase Storage
  amount          decimal(10,2),
  currency        text default 'EUR',
  supplier_name   text,
  supplier_country text,
  notes           text,
  status          text default 'pending' check (status in ('pending','approved','rejected','reimbursed')),
  created_at      timestamptz default now()
);

-- ============================================================
-- LOGS D'ACTIVITÉ
-- ============================================================
create table public.activity_logs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.users(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  details     jsonb,
  ip_address  text,
  created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Activer RLS sur toutes les tables sensibles
alter table public.users enable row level security;
alter table public.user_modules enable row level security;
alter table public.interventions enable row level security;
alter table public.driver_documents enable row level security;
alter table public.fund_advances enable row level security;
alter table public.activity_logs enable row level security;

-- Les tables de référence sont lisibles par tous les users authentifiés
alter table public.modules enable row level security;
alter table public.list_items enable row level security;
alter table public.vehicle_brands enable row level security;
alter table public.vehicle_models enable row level security;
alter table public.call_shortcuts enable row level security;

-- Policies — tables de référence (lecture publique pour users auth)
create policy "Authenticated users can read modules"     on public.modules      for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read list_items"  on public.list_items   for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read brands"      on public.vehicle_brands for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read models"      on public.vehicle_models for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read shortcuts"   on public.call_shortcuts for select using (auth.role() = 'authenticated');

-- Policies — users
create policy "Users can read own profile"    on public.users for select using (auth.uid()::text = azure_id);
create policy "Admins can read all users"     on public.users for select using (exists (select 1 from public.users u where u.azure_id = auth.uid()::text and u.role in ('admin','superadmin')));
create policy "Admins can update users"       on public.users for update using (exists (select 1 from public.users u where u.azure_id = auth.uid()::text and u.role in ('admin','superadmin')));

-- Policies — user_modules
create policy "Users can read own modules"    on public.user_modules for select using (exists (select 1 from public.users u where u.id = user_modules.user_id and u.azure_id = auth.uid()::text));
create policy "Admins can manage all modules" on public.user_modules for all using (exists (select 1 from public.users u where u.azure_id = auth.uid()::text and u.role in ('admin','superadmin')));

-- Policies — interventions
create policy "Drivers see own interventions" on public.interventions for select using (exists (select 1 from public.users u where u.id = interventions.driver_id and u.azure_id = auth.uid()::text));
create policy "Drivers can insert"            on public.interventions for insert with check (exists (select 1 from public.users u where u.id = interventions.driver_id and u.azure_id = auth.uid()::text));
create policy "Admins see all interventions"  on public.interventions for all using (exists (select 1 from public.users u where u.azure_id = auth.uid()::text and u.role in ('admin','superadmin','dispatcher')));

-- Policies — documents
create policy "Drivers see own docs"  on public.driver_documents for select using (exists (select 1 from public.users u where u.id = driver_documents.user_id and u.azure_id = auth.uid()::text));
create policy "Admins see all docs"   on public.driver_documents for all using (exists (select 1 from public.users u where u.azure_id = auth.uid()::text and u.role in ('admin','superadmin')));

-- ============================================================
-- FONCTION UTILITAIRE — vérifier si un user a accès à un module
-- ============================================================
create or replace function public.user_has_module(p_azure_id text, p_module_id text)
returns boolean as $$
  select exists (
    select 1
    from public.users u
    join public.user_modules um on um.user_id = u.id
    where u.azure_id = p_azure_id
      and um.module_id = p_module_id
      and um.granted = true
      and u.active = true
  );
$$ language sql security definer;

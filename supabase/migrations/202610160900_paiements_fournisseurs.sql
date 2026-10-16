-- Paiements fournisseurs (Olivier 16/10/2026), VD et Riga séparés :
-- 1. Olivier trie les factures fournisseur à payer et les ajoute à la liste d'attente ;
-- 2. chaque jour ouvrable à 14 h 30, Momo choisit dans la liste d'attente ce qui part dans le lot ;
--    ce qu'il ne prend pas reste en attente et revient seul la fois suivante ;
-- 3. lot créé → Olivier prévenu : il génère le fichier XML et l'encode à la banque.
create table if not exists public.paiements_attente (
  id            uuid primary key default gen_random_uuid(),
  company_id    int  not null,
  move_id       int  not null,
  move_name     text not null,
  partner_id    int,
  partner_name  text,
  ref           text,
  invoice_date  date,
  due_date      date,
  amount        numeric(12,2) not null,
  communication text,
  statut        text not null default 'attente' check (statut in ('attente', 'pris', 'retire')),
  ajoute_par    uuid,
  ajoute_le     timestamptz not null default now(),
  retire_par    uuid,
  retire_le     timestamptz,
  pris_par      uuid,
  pris_le       timestamptz,
  lot           text,
  paiement      text
);
create unique index if not exists paiements_attente_une_fois on public.paiements_attente (company_id, move_id) where statut = 'attente';
create index if not exists paiements_attente_statut_idx on public.paiements_attente (company_id, statut);
alter table public.paiements_attente disable row level security;
grant all on public.paiements_attente to service_role;

-- Qui choisit le lot (en plus des superadmins) : Momo, sur ses deux comptes.
insert into public.app_settings (key, value)
values ('paiements_lot_user_ids', '["1b628f46-44ef-4a89-bdd7-a648e03f2154","e7cbab7f-1d0a-4109-ab60-7b223d088b57"]')
on conflict (key) do nothing;

-- Qui est prévenu qu'un lot est créé (il génère le XML et l'encode à la banque) : Olivier (Mobi).
insert into public.app_settings (key, value)
values ('paiements_xml_user_ids', '["29df3445-f452-4ebc-a7bb-c16a8377289b"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

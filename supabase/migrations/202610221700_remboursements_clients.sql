-- Remboursements clients dans les paiements (Olivier 22/10/2026, maquette validée) : doubles paiements reçus,
-- à rembourser (virement dans le lot de Momo) ou à compenser. Les notes de crédit des particuliers viennent de l'ERP.
create table if not exists public.remboursements_clients (
  id            uuid primary key default gen_random_uuid(),
  company_id    int  not null,
  partner_id    int  not null,
  partner_name  text not null,
  amount        numeric(12,2) not null,
  recu_le       date,
  facture       text,
  motif         text,
  bank_line_id  int,
  iban          text,
  options       text[] not null default '{}',
  choix         text,
  statut        text not null default 'a_trier' check (statut in ('a_trier', 'attente', 'pris', 'a_compenser', 'compte_a_demander', 'retire')),
  note          text,
  attente_id    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists remboursements_clients_statut_idx on public.remboursements_clients (company_id, statut);
alter table public.remboursements_clients disable row level security;
grant all on public.remboursements_clients to service_role;

-- Une ligne de la liste d'attente peut payer une LIGNE d'écriture (trop-perçu d'un client) au lieu d'une facture.
alter table public.paiements_attente add column if not exists aml_id int;
alter table public.paiements_attente add column if not exists remb_id uuid;

-- Les 6 doubles paiements ING 2026 encore ouverts au 21/10/2026 (liste revérifiée envoyée à Mobi).
insert into public.remboursements_clients (company_id, partner_id, partner_name, amount, recu_le, facture, motif, bank_line_id, iban, options)
select * from (values
  (1, 1543, 'Centre de Tri de Tinlot', 350.00::numeric, date '2026-06-11', '2026/05/479', 'Facture déjà payée par virement le 28/05', 9520, 'BE14068934086583', '{}'::text[]),
  (1, 1640, 'Petit Forestier Belgique', 411.30, date '2026-07-01', '2026/06/289', 'Facture déjà payée par virement le 17/06', 9892, 'FR7630004025110001094937868', '{}'),
  (1, 2037, 'Sos International DK A/S', 240.00, date '2026-08-10', '2026/07/795', 'Facture déjà payée en Bancontact à la fourrière le 31/07', 10593, 'DK3920005036356768', '{personne}'),
  (1, 62,   'Logicx Internationaal Transport B.V.', 260.00, date '2026-08-18', '2026/07/038 et 2026/07/039', 'Factures soldées, 260 € reçus en trop (nous leur avons aussi payé 432,14 € deux fois : remboursement attendu de leur part)', 10756, 'NL83RABO0132083558', '{compenser}'),
  (1, 56,   'ANWB B.V.', 40.00, date '2026-04-22', '2026/03/457', 'Facture déjà payée en Bancontact à la fourrière le 27/03', 8595, 'NL90RABO0152573615', '{compenser}'),
  (1, 56,   'ANWB B.V.', 784.59, date '2026-07-08', '2026/06/272', 'Facture déjà payée via Paynovate le 12/06', 10047, 'NL90RABO0152573615', '{compenser}')
) as v(company_id, partner_id, partner_name, amount, recu_le, facture, motif, bank_line_id, iban, options)
where not exists (select 1 from public.remboursements_clients);

notify pgrst, 'reload schema';

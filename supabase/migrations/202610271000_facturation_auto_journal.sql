-- Interrupteur général de la facturation automatique (Olivier 26/10/2026 : « Je veux pouvoir mettre en off et en on
-- quand je veux »). L'état est dans app_settings.auto_invoice_global_enabled ; chaque bascule est inscrite ici
-- (qui, quand, motif). Off = auto-invoice, circuit, clôture Allianz et validation Touring COMEX s'arrêtent ;
-- on = l'arriéré repart au passage suivant. Seul Olivier bascule (réglage facturation_auto_interrupteur_user_ids) :
-- une tentative d'un autre compte est refusée et inscrite ici (action « refus »).
create table if not exists public.facturation_auto_journal (
  id       bigserial primary key,
  action   text not null check (action in ('suspension', 'reprise', 'refus')),
  par_id   uuid,
  par_nom  text,
  motif    text,
  at       timestamptz not null default now()
);
create index if not exists facturation_auto_journal_at_idx on public.facturation_auto_journal (at desc);

alter table public.facturation_auto_journal disable row level security;
grant all on public.facturation_auto_journal to service_role;
grant usage, select on sequence public.facturation_auto_journal_id_seq to service_role;

notify pgrst, 'reload schema';

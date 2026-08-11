-- Marqueur « mission AXA go&assist soldée » (flux 2, Olivier 2026-08-11).
-- Posé seulement quand le RAPPORT FINAL est accepté (isSendingToAxa:true) :
-- pointer toutes les étapes ne suffit pas, la mission reste ouverte chez AXA
-- tant que le rapport n'est pas passé. Sert aussi de garde d'idempotence.
alter table public.incoming_missions
  add column if not exists axa_closed_at timestamptz;

comment on column public.incoming_missions.axa_closed_at is
  'Horodatage du solde de la mission chez AXA go&assist (séquence + rapport final)';

notify pgrst, 'reload schema';

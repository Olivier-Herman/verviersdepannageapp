-- Commande d'assistance pour un véhicule au parc sur appel police (Olivier 16/11/2026, 1FEO036) :
-- question au dispatch (relivraison avec ou sans prise en charge de l'appel police, ou mission à part).
-- Cf src/lib/missions/rel-police.ts.
alter table public.incoming_missions add column if not exists rel_police jsonb;
comment on column public.incoming_missions.rel_police is
  'Commande d''assistance pour un véhicule au parc sur appel police : { parent_id, parent_number, request_group, detected_at, decision (rel_pec|rel|isolee), decided_at, decided_by, payeur_avant }.';
create index if not exists idx_incoming_missions_rel_police_pending
  on public.incoming_missions ((rel_police->>'parent_id')) where rel_police is not null and (rel_police->>'decided_at') is null;
notify pgrst, 'reload schema';

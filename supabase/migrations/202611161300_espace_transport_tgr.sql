-- Espace client : formulaire « transport » pour les demandeurs TGR Touring (Olivier 16/11/2026).
-- SD Dépannages commande ses transports par l'espace client : véhicule roulant ou non, priorité Touring
-- (1 = prochain jour ouvrable avant midi, 2 = prochain jour ouvrable dans la journée, 3 = dès que possible)
-- et échéance calculée, gardées sur la fiche pour le rapport mensuel envoyé au responsable Touring.

alter table espace_societes
  add column if not exists formulaire text not null default 'standard';
alter table espace_societes drop constraint if exists espace_societes_formulaire_check;
alter table espace_societes
  add constraint espace_societes_formulaire_check check (formulaire in ('standard', 'transport'));

alter table incoming_missions
  add column if not exists transport_priorite smallint,
  add column if not exists transport_echeance timestamptz;
alter table incoming_missions drop constraint if exists incoming_missions_transport_priorite_check;
alter table incoming_missions
  add constraint incoming_missions_transport_priorite_check check (transport_priorite is null or transport_priorite in (1, 2, 3));

comment on column espace_societes.formulaire is 'Formulaire de commande de l''espace client : standard (dépannage ou remorquage) ou transport (TGR Touring).';
comment on column incoming_missions.transport_priorite is 'Transport commandé par l''espace client : priorité Touring 1, 2 ou 3.';
comment on column incoming_missions.transport_echeance is 'Transport commandé par l''espace client : échéance de livraison (vide = dès que possible).';

notify pgrst, 'reload schema';

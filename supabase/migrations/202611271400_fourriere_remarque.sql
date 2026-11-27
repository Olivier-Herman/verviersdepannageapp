-- Remarque libre sur une fiche au parc (Olivier 27/11/2026) : onglet « Policiers à encoder »
-- de l'écran Réquisitoires (policier à retrouver, informations utiles sur le véhicule saisi).
alter table incoming_missions add column if not exists fourriere_remarque text;

notify pgrst, 'reload schema';

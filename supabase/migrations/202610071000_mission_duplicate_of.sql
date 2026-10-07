-- Fiche en double d'une même mission (Olivier 07/10/2026) : quand le bon de commande d'une fiche est
-- annulé dans l'ERP par « C'est un doublon » et que la facture existante appartient à une autre fiche,
-- cette fiche est marquée « doublon de » l'autre et sort de la facturation (ni supprimée ni annulée :
-- ses pointages et photos restent).
alter table incoming_missions add column if not exists duplicate_of_mission_id uuid references incoming_missions(id);
create index if not exists incoming_missions_duplicate_of on incoming_missions (duplicate_of_mission_id) where duplicate_of_mission_id is not null;
notify pgrst, 'reload schema';

-- Réception motifs : couleur de fond du bouton (borne) + section de regroupement.
alter table reception_motifs add column if not exists color   text;   -- hex #RRGGBB
alter table reception_motifs add column if not exists section text;   -- ex. « Véhicule », « Administratif »

notify pgrst, 'reload schema';

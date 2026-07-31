-- Correctif : fiche_interactions préexistait (version antérieure) → le
-- « create table if not exists » de la migration réception n'a PAS ajouté
-- motif_id / motif_label. On les ajoute explicitement. Olivier 2026-07-31.
alter table fiche_interactions add column if not exists motif_id    uuid references reception_motifs(id) on delete set null;
alter table fiche_interactions add column if not exists motif_label text;

notify pgrst, 'reload schema';

-- Relevé de parc : référence notée à la craie sur le pare-brise (V100, V101…) et reprise sur l'étiquette.
-- Olivier 18/10/2026 : au retour avec les étiquettes, on retrouve le véhicule sans le rechercher.
alter table public.parc_releve_items add column if not exists ref_craie text;
create unique index if not exists parc_releve_items_ref_craie_uq on public.parc_releve_items (ref_craie) where ref_craie is not null;
notify pgrst, 'reload schema';

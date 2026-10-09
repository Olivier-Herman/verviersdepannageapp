-- Pièces réclamées : la réponse sans pièce déjà signalée à Mobi (id du mail), pour ne l'annoncer qu'une fois.
-- Le 09/10/2026, une même réponse (Verisure, Autosécurité) était réannoncée toutes les heures : le mail reste
-- dans la boîte, le tri le relit à chaque passage et le garde-fou ne tenait qu'une heure.
alter table mail_piece_requests add column if not exists alerted_reply_ids text[] not null default '{}';

notify pgrst, 'reload schema';

-- Pièces réclamées : suivi complet (Olivier 07/10/2026, « ok pour ta proposition »).
-- Registre des demandes de documents envoyées aux fournisseurs : société destinataire, référence,
-- fil de conversation, lien vers le point du dossier comptable, relance à J+7 (brouillon présenté
-- à Mobi, rien ne part seul), escalade à J+14.
alter table mail_piece_requests add column if not exists conversation_id   text;
alter table mail_piece_requests add column if not exists company_id        integer;
alter table mail_piece_requests add column if not exists fournisseur       text;
alter table mail_piece_requests add column if not exists reference         text;
alter table mail_piece_requests add column if not exists dossier_point_id  uuid references dossier_comptable_points(id) on delete set null;
alter table mail_piece_requests add column if not exists relance_draft_id  text;
alter table mail_piece_requests add column if not exists relanced_at       timestamptz;
alter table mail_piece_requests add column if not exists escalated_at      timestamptz;
alter table mail_piece_requests add column if not exists last_reply_at     timestamptz;
create index if not exists mail_piece_requests_conv on mail_piece_requests (conversation_id) where status = 'open';
notify pgrst, 'reload schema';

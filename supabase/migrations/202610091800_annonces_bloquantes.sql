-- Annonce BLOQUANTE (Olivier 09/10/2026) : affichée en plein écran chez les destinataires, impossible à fermer
-- tant qu'ils n'ont pas cliqué « J'ai lu ce message » ; la confirmation alimente announcement_reads.
alter table announcements add column if not exists blocking boolean not null default false;

notify pgrst, 'reload schema';

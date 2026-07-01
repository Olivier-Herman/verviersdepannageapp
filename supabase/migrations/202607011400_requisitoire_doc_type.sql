-- 202607011400_requisitoire_doc_type.sql
-- Généralise la file d'intake à plusieurs types de documents police reçus dans
-- fourriere@ : réquisitoire ET levée de saisie (même module). Olivier 2026-07-01.
--
-- doc_type : 'requisitoire' | 'levee_saisie' | 'autre'.
-- La levée peut arriver SANS pièce jointe (simple mail du policier) → dans ce cas
-- on annexe une capture HTML du mail (doc_path pointe alors sur un .html).

alter table public.requisitoire_intake
  add column if not exists doc_type text not null default 'requisitoire';

comment on column public.requisitoire_intake.doc_type is
  'Type de document capturé : requisitoire | levee_saisie | autre.';

notify pgrst, 'reload schema';

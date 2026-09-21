-- Doublon Touring soumis au dispatch (Olivier 21/09/2026) : une fiche Touring reçue
-- sur un dossier déjà intervenu n'est plus annulée automatiquement ; on pose la
-- question au dispatch (question à l'équipe) et on trace ici la question et la réponse.
alter table public.incoming_missions
  add column if not exists dup_question_at timestamptz,
  add column if not exists dup_question_answer text,
  add column if not exists dup_question_answered_at timestamptz;
notify pgrst, 'reload schema';

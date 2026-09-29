-- Agent Mail : consignes en clair, comme le Courrier (Olivier 29/09/2026).
-- Consigne retenue par expéditeur, proposée d'office aux prochains mails.
CREATE TABLE IF NOT EXISTS public.mail_agent_rules (
  sender_email  text PRIMARY KEY,
  instruction   text NOT NULL,
  used_count    integer NOT NULL DEFAULT 0,
  updated_by    uuid REFERENCES public.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mail_agent_rules DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.mail_agent_rules TO service_role;

-- Une tâche peut naître d'un mail (Agent Mail) comme d'un courrier : une seule liste.
ALTER TABLE public.courrier_tasks ALTER COLUMN courrier_id DROP NOT NULL;
ALTER TABLE public.courrier_tasks ADD COLUMN IF NOT EXISTS mail_item_id uuid REFERENCES public.mail_agent_items(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';

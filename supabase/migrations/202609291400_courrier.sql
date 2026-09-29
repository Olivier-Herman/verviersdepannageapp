-- ============================================================
-- 202609291400_courrier — module Courrier (Olivier, maquette v2 validée le 29/09/2026)
-- ============================================================
-- Tout le courrier papier, scanné ou photographié. Claude lit, propose pour qui
-- (Verviers Dépannage / Dépannage Riga / DGJ VHU), le type, le rattachement et
-- les gestes à faire ; un humain valide, corrige ou explique ; l'app retient la
-- procédure par expéditeur.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.courriers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id),
  source       text NOT NULL DEFAULT 'scan' CHECK (source IN ('scan', 'photo', 'fichier')),
  pages        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ path, mime }]
  status       text NOT NULL DEFAULT 'reading' CHECK (status IN ('reading', 'to_validate', 'done', 'ignored', 'error')),
  error        text,
  reading      jsonb,                                -- ce que Claude a lu
  sender_key   text,                                 -- expéditeur normalisé (procédures retenues)
  proposal     jsonb,                                -- { entity, entity_conf, type, type_conf, link, plan[], rule }
  mission_id   uuid REFERENCES public.incoming_missions(id) ON DELETE SET NULL,
  decision     jsonb,                                -- { how, by, at, entity, type, link, instruction, plan[], results[] }
  decided_at   timestamptz,
  decided_by   uuid REFERENCES public.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courriers_status ON public.courriers (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courriers_sender ON public.courriers (sender_key);
CREATE INDEX IF NOT EXISTS idx_courriers_mission ON public.courriers (mission_id);

-- Tâches nées d'un courrier (tâche à faire par une personne, avec échéance).
CREATE TABLE IF NOT EXISTS public.courrier_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courrier_id  uuid NOT NULL REFERENCES public.courriers(id) ON DELETE CASCADE,
  assignee_id  uuid REFERENCES public.users(id),
  title        text NOT NULL,
  due_at       timestamptz,
  created_by   uuid REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz,
  done_by      uuid REFERENCES public.users(id)
);
CREATE INDEX IF NOT EXISTS idx_courrier_tasks_open ON public.courrier_tasks (assignee_id, done_at, due_at);

-- Procédures retenues par expéditeur (apprentissage).
CREATE TABLE IF NOT EXISTS public.courrier_rules (
  sender_key      text PRIMARY KEY,
  sender_label    text NOT NULL,
  entity          text,
  doc_type        text,
  instruction     text,                 -- consigne en clair, telle qu'expliquée
  validated_count integer NOT NULL DEFAULT 0,
  corrected_count integer NOT NULL DEFAULT 0,
  updated_by      uuid REFERENCES public.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.courriers      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.courrier_tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.courrier_rules DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.courriers, public.courrier_tasks, public.courrier_rules TO service_role;

-- Stockage privé des scans (lu par adresses signées).
INSERT INTO storage.buckets (id, name, public) VALUES ('courrier', 'courrier', false) ON CONFLICT (id) DO NOTHING;

-- Pilote : superadmins + Jona.
INSERT INTO public.feature_flags (key, mode, label, pilot_user_ids)
VALUES ('courrier', 'superadmin', 'Courrier — scan, lecture, actions et procédures apprises', ARRAY['eda29707-c9c7-47b5-ab21-084ea22201bc']::uuid[])
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

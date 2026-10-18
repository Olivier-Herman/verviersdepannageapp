-- Relevé de parc sans étiquette (Olivier 18/10/2026, inventaire du dépôt de Verviers) : une session par lieu, une
-- ligne par véhicule relevé, avec ce que VD Soft a trouvé (fiches, Towsoft, mails, ERP) et la décision prise.
CREATE TABLE IF NOT EXISTS public.parc_releves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lieu        text NOT NULL,
  started_by  uuid REFERENCES public.users(id),
  started_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  note        text
);
CREATE TABLE IF NOT EXISTS public.parc_releve_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  releve_id         uuid NOT NULL REFERENCES public.parc_releves(id) ON DELETE CASCADE,
  plate             text,
  vin               text,
  brand             text,
  model             text,
  intervention_date date,
  remark            text,
  candidates        jsonb,
  decision          text,            -- present_ok | garder | scratch | note
  mission_id        uuid REFERENCES public.incoming_missions(id),
  mission_number    bigint,
  created_mission   boolean NOT NULL DEFAULT false,
  label_printed     boolean NOT NULL DEFAULT false,
  result            text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parc_releve_items_releve ON public.parc_releve_items(releve_id, created_at);
ALTER TABLE public.parc_releves DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.parc_releve_items DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.parc_releves, public.parc_releve_items TO service_role;

notify pgrst, 'reload schema';

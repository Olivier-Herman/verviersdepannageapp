-- Restitution unifiée (Olivier 28/09/2026, maquette https://claude.ai/artifact/F14wwMHQwPtrkR5BHRW9Zd).
-- Un parcours par véhicule au parc : qui vient → peut-il sortir → (qui paie quoi)
-- → montant et paiement → signature/photos → sortie. Chaque action est tracée
-- au journal de la fiche (mission_logs, actions « restitution_* ») avec son
-- auteur ; chaque dérogation est demandée à un responsable qui la valide avec
-- son code personnel sur SON téléphone (notification).

-- Responsables habilités à valider une dérogation de restitution.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS restitution_responsable boolean NOT NULL DEFAULT false;
UPDATE public.users SET restitution_responsable = true
 WHERE id IN (
   '29df3445-f452-4ebc-a7bb-c16a8377289b',  -- Mobi
   'c4044c9d-24f4-4083-aa82-0e490a97194f',  -- Axel
   'eda29707-c9c7-47b5-ab21-084ea22201bc',  -- Jona
   'de1c6853-fd3c-47fc-b755-82c5b13b0322',  -- Matthieu
   'e7cbab7f-1d0a-4109-ab60-7b223d088b57'   -- Momo (compte Bureau)
 );

CREATE TABLE IF NOT EXISTS public.restitutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id       uuid NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  who_kind         text,          -- owner | mandate | garage | assistance | transport
  client           jsonb,         -- { kind: prive|pro, name, first_name, last_name, vat, street, zip, city, country, phone, email, contact, source: eid|manual, national_number, birth_date }
  odoo_partner_id  integer,
  id_document_id   uuid,          -- photo de la pièce (mission_documents)
  split            jsonb,         -- saisie : { dep: client|parquet|fdj, avant: …, apres: … }
  temp_levee       boolean NOT NULL DEFAULT false,
  amount_htva      numeric(12,2),
  amount_tvac      numeric(12,2),
  invoice_odoo_id  integer,
  invoice_url      text,
  settlement       text,          -- paid_odoo | driver_cash | later | nothing_due | derogation
  signed_at        timestamptz,
  signature_path   text,
  started_by       uuid REFERENCES public.users(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_by     uuid REFERENCES public.users(id),
  completed_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restitution_open ON public.restitutions (mission_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.derogation_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      uuid NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  restitution_id  uuid REFERENCES public.restitutions(id) ON DELETE CASCADE,
  kind            text NOT NULL,   -- blk | levee | exit_control | identite | montant | paiement
  reason          text NOT NULL,
  amount_tvac     numeric(12,2),
  requested_by    uuid REFERENCES public.users(id),
  responsable_id  uuid NOT NULL REFERENCES public.users(id),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','refused','cancelled')),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_derogation_requests_mission ON public.derogation_requests (mission_id, status);
CREATE INDEX IF NOT EXISTS idx_derogation_requests_resp ON public.derogation_requests (responsable_id, status);

ALTER TABLE public.restitutions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.derogation_requests DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.restitutions TO service_role;
GRANT ALL ON public.derogation_requests TO service_role;

-- Pilote : superadmins + Jona d'abord.
INSERT INTO public.feature_flags (key, mode, label, pilot_user_ids)
VALUES ('restitution_v2', 'superadmin', 'Restitution unifiée (bouton Restituer sur tout véhicule au parc)', ARRAY['eda29707-c9c7-47b5-ab21-084ea22201bc']::uuid[])
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

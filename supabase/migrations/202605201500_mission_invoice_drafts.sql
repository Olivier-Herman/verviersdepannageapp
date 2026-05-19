-- ============================================================
-- 202605201500_mission_invoice_drafts
-- ============================================================
-- Persiste les brouillons d edition des lignes du devis cote app.
-- Permet a l employe de modifier les lignes (qty/PU/description) et
-- de fermer le modal sans perdre ses modifs ; au prochain ouverture
-- le brouillon est rechargé.
--
-- Une ligne par mission (PK = mission_id). Le brouillon est efface
-- automatiquement quand on push le devis vers Odoo (CREATE/UPDATE OK).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mission_invoice_drafts (
  mission_id  UUID PRIMARY KEY REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  lines       JSONB NOT NULL,           -- array de CustomLine { kind, name, qty, price_unit }
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES public.users(id)
);

ALTER TABLE public.mission_invoice_drafts DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.mission_invoice_drafts TO service_role;

COMMENT ON TABLE public.mission_invoice_drafts IS
  'Brouillon d edition des lignes du devis. Cree/maj a chaque "Sauvegarder", efface au push vers Odoo.';
COMMENT ON COLUMN public.mission_invoice_drafts.lines IS
  'JSONB array de { kind: SERV-*, name: text, qty: number, price_unit: number }';

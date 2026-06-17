-- supabase/migrations/202606172000_mission_billed_items.sql
--
-- Olivier 2026-06-17 : registre des postes DÉJÀ FACTURÉS d'une mission, pour la
-- facture partielle fourrière (on facture le dépannage, le véhicule reste en
-- parc, le gardiennage est facturé par période jusqu'à la sortie). Source de
-- vérité côté VD Soft : à la facturation finale on exclut ces postes et on ne
-- propose que le solde. Cf [[project_facture_partielle]].
--
-- Accès 100 % serveur (routes API en service_role) → RLS activé sans policy
-- (service_role contourne le RLS), conforme à la nuance sécurité.

CREATE TABLE IF NOT EXISTS public.mission_billed_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  mission_id    UUID NOT NULL,                 -- incoming_missions.id

  kind          TEXT NOT NULL,                 -- SERV-PEC / SERV-KM / SERV-PARC / SERV-DIV / SERV-MAJ
  label         TEXT NOT NULL,
  qty           NUMERIC(12,4) NOT NULL DEFAULT 1,
  price_unit    NUMERIC(12,4) NOT NULL DEFAULT 0,  -- HTVA
  amount_htva   NUMERIC(12,4) NOT NULL DEFAULT 0,  -- qty * price_unit (snapshot)

  -- Gardiennage : période couverte par cette ligne (pour facturer par tranches)
  period_from   DATE,
  period_to     DATE,

  -- Lien vers le doc Odoo de cette facture partielle (devis préparé par l'app)
  odoo_quote_id INTEGER,

  billed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  billed_by     UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_billed_items_mission
  ON public.mission_billed_items (mission_id, billed_at);

ALTER TABLE public.mission_billed_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mission_billed_items FROM anon, authenticated, public;
GRANT ALL ON public.mission_billed_items TO service_role;

COMMENT ON TABLE public.mission_billed_items IS
  'Postes déjà facturés d''une mission (facture partielle fourrière). Permet de '
  'ne facturer que le solde au final. Gardiennage facturé par période (period_from/to). '
  'Accès serveur only (service_role). Cf project_facture_partielle.';

NOTIFY pgrst, 'reload schema';

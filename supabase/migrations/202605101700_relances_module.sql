-- ============================================================
-- Module Relance Client — Phase 1
-- ============================================================
-- Tracking 100% Supabase, factures source = Odoo (account.move).
-- Le module est activable par utilisateur via la table user_modules
-- existante (convention projet : pas d'exception admin/superadmin).
--
-- Niveaux de relance (standard belge strict) :
--   L1 = retard >= 15 jours  (amical)
--   L2 = retard >= 30 jours  (ferme)
--   L3 = retard >= 60 jours  (mise en demeure renvoyant aux CGV)
--
-- Le mode dry_run permet de tester la chaîne complète (PDF, XLSX, upload
-- Storage, INSERT tracking) sans envoyer l'email Microsoft Graph. Utile
-- pour valider visuellement avant un envoi réel à un client.

-- 1. Module dans la table de référence
INSERT INTO public.modules (id, label, description, icon, sort_order)
VALUES (
  'relances',
  'Relance Client',
  'Génération et envoi de relances clients pour factures Odoo échues',
  '📨',
  10
)
ON CONFLICT (id) DO NOTHING;

-- 2. Table tracking des relances envoyées
CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id_odoo   integer       NOT NULL,
  partner_name      text          NOT NULL,
  level             integer       NOT NULL CHECK (level IN (1, 2, 3)),
  sent_at           timestamptz   NOT NULL DEFAULT now(),
  sent_by_user_id   uuid          REFERENCES public.users(id) ON DELETE SET NULL,
  email_to          text          NOT NULL,
  invoice_count     integer       NOT NULL,
  total_amount      numeric(12,2) NOT NULL,
  invoice_ids_odoo  integer[]     NOT NULL,
  pdf_url           text,
  xlsx_url          text,
  graph_message_id  text,
  dry_run           boolean       NOT NULL DEFAULT false,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.invoice_reminders IS
  'Historique des relances clients envoyees. Source factures = Odoo account.move.';
COMMENT ON COLUMN public.invoice_reminders.level IS
  '1 = amical (>=15j), 2 = ferme (>=30j), 3 = mise en demeure (>=60j)';
COMMENT ON COLUMN public.invoice_reminders.invoice_ids_odoo IS
  'IDs Odoo des factures incluses dans cette relance, pour tracabilite.';
COMMENT ON COLUMN public.invoice_reminders.graph_message_id IS
  'Message ID Microsoft Graph retourne par sendMail. NULL en Phase 1 (sendMail retourne 202 sans body). Phase 2 : migration createDraft+send pour avoir l ID exact.';
COMMENT ON COLUMN public.invoice_reminders.dry_run IS
  'TRUE = relance simulee (PDF/XLSX generes + tracking en base, mais aucun email envoye via Graph). Permet de valider la chaine avant un envoi reel.';

-- 3. Index pour le garde-fou anti-doublon
--    (lookup "derniere relance Lx pour partner X" = utilise par la liste
--    /api/relances/list pour afficher "L2 envoyee il y a 3j" en warning UI).
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_partner_level_sent
  ON public.invoice_reminders (partner_id_odoo, level, sent_at DESC);

-- Index secondaire pour la liste history triee par date
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_sent_at
  ON public.invoice_reminders (sent_at DESC);

-- 4. RLS desactivee (table accedee uniquement par les routes API service_role,
--    cf. convention projet sur les tables manipulees via createAdminClient).
ALTER TABLE public.invoice_reminders DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Storage bucket — prive, signed URLs uniquement
-- ============================================================
-- Pattern coherent avec les buckets existants `advances` et `documents` :
-- prive (public=false), pas de policy storage car acces via service_role
-- uniquement (createAdminClient dans les routes /api/relances/*).
-- Les fichiers sont recuperes par signed URL TTL 1 an generee server-side.

INSERT INTO storage.buckets (id, name, public)
VALUES ('reminders', 'reminders', false)
ON CONFLICT (id) DO NOTHING;

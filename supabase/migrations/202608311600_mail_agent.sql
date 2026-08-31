-- Module « Agent Mail » — file de traitement des mails administratifs.
--
-- POURQUOI une file plutôt qu'un traitement direct : les gestes que l'agent
-- prépare (note de crédit, refacturation) ont un impact comptable et partent
-- chez le comptable externe. On matérialise donc chaque mail comme un ITEM
-- avec son diagnostic, ses garde-fous et son résultat, pour qu'un humain
-- puisse relire AVANT que quoi que ce soit ne soit posté — et pour garder la
-- trace de ce que l'agent a fait quand il aura le droit de valider seul.
--
-- `handler` = quel traitement métier s'applique. Premier livré : 'ima_rejet'
-- (rejets de facture IMA/P&V, cf. mails de facturation.prestataires@ima.eu et
-- hub@imabenelux.com). L'architecture est volontairement extensible : Allianz,
-- VAB, Logicx viendront comme d'autres valeurs de `handler`, sans migration.
--
-- Statuts :
--   pending    → capturé, pas encore analysé
--   ready      → analysé, garde-fous verts, prêt à être appliqué
--   blocked    → analysé mais un garde-fou s'y oppose (doublon, déjà payée,
--                déjà extournée, déjà adressée à la bonne entité…)
--   to_verify  → l'agent n'a pas su lire le mail avec certitude → œil humain
--   applied    → NC + nouvelle facture produites dans Odoo
--   ignored    → écarté à la main
--   error      → échec technique (Odoo/Graph), rejouable

CREATE TABLE IF NOT EXISTS mail_agent_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── provenance du mail ──
  handler              text NOT NULL,
  mailbox              text NOT NULL,
  message_id           text NOT NULL,
  folder               text,
  received_at          timestamptz,
  from_email           text,
  subject              text,

  -- ── diagnostic de l'agent ──
  status               text NOT NULL DEFAULT 'pending',
  extracted            jsonb,          -- facture, montant, entité exigée, référence…
  checks               jsonb,          -- résultat de chaque garde-fou
  blocked_reason       text,

  -- ── cible Odoo ──
  odoo_move_id         integer,        -- la facture rejetée
  odoo_move_name       text,
  target_partner_id    integer,        -- fiche « Invoice » de l'entité exigée
  target_partner_name  text,

  -- ── résultat ──
  credit_note_id       integer,
  credit_note_name     text,
  new_invoice_id       integer,
  new_invoice_name     text,
  mail_moved           boolean NOT NULL DEFAULT false,
  error                text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  applied_at           timestamptz,
  applied_by           text
);

-- Un même mail ne doit être capturé qu'une fois, même si le cron repasse.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_agent_items_msg
  ON mail_agent_items (mailbox, message_id, handler);

CREATE INDEX IF NOT EXISTS idx_mail_agent_items_status
  ON mail_agent_items (status, received_at DESC);

-- Deux mails distincts ne doivent pas produire deux extournes de la MÊME
-- facture Odoo : garde-fou en base, en plus du contrôle applicatif.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_agent_items_applied_move
  ON mail_agent_items (odoo_move_id)
  WHERE status = 'applied' AND odoo_move_id IS NOT NULL;

-- Convention maison : sans DISABLE RLS + GRANT, les API service-role échouent.
ALTER TABLE mail_agent_items DISABLE ROW LEVEL SECURITY;
GRANT ALL ON mail_agent_items TO service_role, anon, authenticated;

-- Niveau d'autonomie, réglable sans redéploiement (cf. app_settings = TEXTE).
--   'draft' → l'agent prépare, un humain poste et envoie   (défaut)
--   'auto'  → l'agent applique seul quand tous les garde-fous sont verts
INSERT INTO app_settings (key, value)
VALUES ('mail_agent_mode', '"draft"')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

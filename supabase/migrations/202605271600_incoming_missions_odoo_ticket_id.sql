-- Olivier 2026-05-27 : persiste odoo_ticket_id sur incoming_missions pour
-- pouvoir reconstruire l URL QR vers /v/[ticketId] (page fourriere complete
-- avec Transferer/Domaine/Scratch/Imprimer/Ouvrir Odoo).
--
-- Avant : odooTicketId stocke uniquement dans towsoft_queue (au moment de
-- la creation initiale), pas accessible facilement depuis la mission VD Soft
-- ulterieurement (ex: reimpression etiquette via bouton fiche dispatch).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS odoo_ticket_id INT;

COMMENT ON COLUMN public.incoming_missions.odoo_ticket_id IS
  'Ticket Helpdesk Odoo associe (NULL pour Appel Prive et autres sources sans ticket Helpdesk). Utilise pour construire URL QR /v/[ticketId].';

CREATE INDEX IF NOT EXISTS idx_incoming_missions_odoo_ticket_id
  ON public.incoming_missions (odoo_ticket_id)
  WHERE odoo_ticket_id IS NOT NULL;

-- Backfill : copie odoo_ticket_id depuis towsoft_queue pour les missions
-- recentes qui ont un dossier_number type "PREFIX-{ticketId}".
-- Regex extrait le numero apres le dernier "-".
UPDATE public.incoming_missions m
   SET odoo_ticket_id = (regexp_match(dossier_number, '\d+$'))[1]::INT
 WHERE odoo_ticket_id IS NULL
   AND dossier_number ~ '^[A-Z]+-\d+$';

NOTIFY pgrst, 'reload schema';

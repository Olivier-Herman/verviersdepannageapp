-- Rapport EBAC / Centracar : facture validée + rapport envoyés par mail une seule fois
-- par facture (Olivier 29/09/2026).
ALTER TABLE public.incoming_missions ADD COLUMN IF NOT EXISTS report_emailed_move_ids integer[];
NOTIFY pgrst, 'reload schema';

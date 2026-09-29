-- Rapport d'intervention joint à la facture (Olivier 29/09/2026) : EBAC et Centracar
-- exigent, avec chaque facture, un rapport (véhicule, lieu, livraison, 4 photos,
-- nom + prénom + signature de la personne dépannée ou du réceptionnaire).
-- Exception à « pas de rapport sur une facture », portée par le tag de source
-- `rapport_facture` (jamais un test sur la source dans le code).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS signer_last_name  text,
  ADD COLUMN IF NOT EXISTS signer_first_name text,
  ADD COLUMN IF NOT EXISTS report_attached_move_ids integer[];

UPDATE public.mission_source_catalog
   SET tags = array_append(tags, 'rapport_facture'), updated_at = now()
 WHERE lower(label) IN ('ebac', 'centracar')
   AND NOT ('rapport_facture' = ANY(tags));

NOTIFY pgrst, 'reload schema';

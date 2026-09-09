-- Lot B « admin sans valeurs en dur » (Olivier 09/09/2026) : les LISTES de sources
-- codées (26 constantes dispersées) et les libellés variants (étiquette, vocal,
-- encaissement) deviennent des colonnes du catalogue des sources.
--   tags text[]  : familles métier lues par le code via sourcesWithTag('…')
--     hexalite        clôturé via Hexalite (Allianz / Mondial) — pas d'auto-facturation VD Soft
--     touring         facturé à Touring (Touring, TGR)
--     integration     assistances avec une vraie intégration (grille Flux 2, priorité)
--     cloture_externe la clôture part vraiment chez un tiers (journal d'embarquement)
--     saisie_scope    périmètre Domaine (saisies + fiches migrées)
--     requisitoire    relance / rapprochement du réquisitoire
--     panneau_saisie  panneau Saisie visible sur la fiche
--     siabis          régime Siabis (couvert / non couvert)
--     rel_reprise     relivraison reprise possible par une assistance
--     assistance      assistance « réelle » proposable en reprise de relivraison
--     auto_restitute  encaissement au parc = restitution automatique
--     rel_tarif_rem   la relivraison se facture au tarif remorquage
--     ima_family      famille IMA (dédoublonnage Kaze/mails)
--     etiquette       impression d'étiquettes en lot par défaut
--   label_tts / label_etiquette / label_encaissement : libellés variants
--   billing_group : groupe de la page Facturation (vab, kaze, mondial, axa, touring)
ALTER TABLE mission_source_catalog
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS label_tts text,
  ADD COLUMN IF NOT EXISTS label_etiquette text,
  ADD COLUMN IF NOT EXISTS label_encaissement text,
  ADD COLUMN IF NOT EXISTS billing_group text;

-- Clés rencontrées dans les fiches mais absentes du catalogue (inactives = pas proposées).
INSERT INTO mission_source_catalog (key, label, active, sort_order) VALUES
  ('legacy_odoo', 'Migration Odoo', false, 900),
  ('ima', 'IMA', false, 901),
  ('p&v', 'P&V', false, 902)
ON CONFLICT (key) DO NOTHING;

UPDATE mission_source_catalog SET tags = array_remove(ARRAY[
  CASE WHEN key IN ('allianz','mondial') THEN 'hexalite' END,
  CASE WHEN key IN ('touring','tgr_touring') THEN 'touring' END,
  CASE WHEN key IN ('touring','vab','axa','kaze','mondial') THEN 'integration' END,
  CASE WHEN key IN ('touring','vab','axa') THEN 'cloture_externe' END,
  CASE WHEN key IN ('police_saisie','legacy_odoo') THEN 'saisie_scope' END,
  CASE WHEN key IN ('police_saisie','police_rodeo','police_avp') THEN 'requisitoire' END,
  CASE WHEN key IN ('police_saisie','police_mg','police_rodeo','police_avp') THEN 'panneau_saisie' END,
  CASE WHEN key IN ('police_snc','sia_couvert') THEN 'siabis' END,
  CASE WHEN key IN ('sia_couvert','police_snc','prive','police_accident') THEN 'rel_reprise' END,
  CASE WHEN key IN ('touring','aginsurance','allianz','ethias','kaze','vivium','pv_assistance','axa','ardenne','mondial','vab','tgr_touring','anwb','eurocross','tse') THEN 'assistance' END,
  CASE WHEN key IN ('police_mg','police_avp','police_rodeo','police_accident','police_saisie','police_snc','sia_couvert','prive') THEN 'auto_restitute' END,
  CASE WHEN key IN ('axa','ardenne','mondial') THEN 'rel_tarif_rem' END,
  CASE WHEN key IN ('ethias','vivium','pv_assistance','ima','p&v') THEN 'ima_family' END,
  CASE WHEN key IN ('police_mg','police_rodeo','police_avp','police_saisie','police_accident') THEN 'etiquette' END
]::text[], NULL)
WHERE tags = '{}';

UPDATE mission_source_catalog SET
  label_tts = CASE key WHEN 'police_mg' THEN 'Mal Garée' WHEN 'police_rodeo' THEN 'Rodéo' WHEN 'police_avp' THEN 'Accident voie publique' WHEN 'police_accident' THEN 'Accident' WHEN 'police_saisie' THEN 'Saisie' WHEN 'police_snc' THEN 'Siabis non couvert' WHEN 'sia_couvert' THEN 'Siabis couvert' WHEN 'prive' THEN 'Appel privé' ELSE label_tts END,
  label_etiquette = CASE key WHEN 'police_mg' THEN 'MAL GAREE' WHEN 'police_rodeo' THEN 'RODEO' WHEN 'police_avp' THEN 'AVP' WHEN 'police_accident' THEN 'ACCIDENT' WHEN 'police_saisie' THEN 'SAISIE' WHEN 'police_snc' THEN 'SIABIS NON COUVERT' WHEN 'sia_couvert' THEN 'SIABIS COUVERT' WHEN 'prive' THEN 'APPEL PRIVE' WHEN 'legacy_odoo' THEN 'MIGRATION ODOO' ELSE label_etiquette END,
  label_encaissement = CASE key WHEN 'police_mg' THEN 'Mal Garée' WHEN 'police_rodeo' THEN 'Rodéo' WHEN 'police_avp' THEN 'AVP' WHEN 'police_accident' THEN 'Accident' WHEN 'police_saisie' THEN 'Saisie' WHEN 'police_snc' THEN 'Siabis' WHEN 'sia_couvert' THEN 'Siabis' WHEN 'prive' THEN 'Intervention Privée' ELSE label_encaissement END,
  billing_group = CASE key WHEN 'vab' THEN 'vab' WHEN 'kaze' THEN 'kaze' WHEN 'ethias' THEN 'kaze' WHEN 'pv_assistance' THEN 'kaze' WHEN 'ima' THEN 'kaze' WHEN 'p&v' THEN 'kaze' WHEN 'mondial' THEN 'mondial' WHEN 'axa' THEN 'axa' WHEN 'touring' THEN 'touring' WHEN 'tgr_touring' THEN 'touring' ELSE billing_group END;

-- Dépôts : rôles par drapeau au lieu d'une recherche sur le mot « Pepinster ».
ALTER TABLE depots
  ADD COLUMN IF NOT EXISTS is_snc_hub boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_balisage boolean NOT NULL DEFAULT false;
UPDATE depots SET is_snc_hub = true WHERE name ILIKE '%pepinster%';
UPDATE depots SET is_balisage = true WHERE name ILIKE '%pepinster%' OR name ILIKE '%aywaille%';

NOTIFY pgrst, 'reload schema';

-- Domaine — Vente d'épaves : le REGISTRE = la trace domaine_ventes_epaves, qui
-- reflète EXACTEMENT les tableaux envoyés par Rosemarie (TOUTES les lignes de
-- chaque mail, rapprochées à une fiche VD Soft ou non — certaines épaves sont
-- encore chez TowSoft). Le gardiennage se calcule à partir du mail seul :
--   Date IN  = colonne date du mail (après le VIN) = remise
--   Date OUT = date maximale d'enlèvement du mail (éditable si à compléter)
-- Champs opérationnels ajoutés à la trace :
--   date_in            = Date IN reprise du mail
--   date_out           = Date OUT (défaut = max_enlevement_date ; éditable)
--   sortie_reelle_date = date de sortie physique réelle (aucun impact sur les
--                        jours facturés ; si la ligne est rapprochée, passe la
--                        fiche en « à facturer » + cachet Domaine)
--   prepare_at         = « Préparation OK » (ligne verte, bouton masqué)
-- Rappel : `numero` = référence Domaine (N° véhicule du mail), PAS la plaque.

alter table domaine_ventes_epaves
  add column if not exists date_in            date,
  add column if not exists date_out           date,
  add column if not exists sortie_reelle_date date,
  add column if not exists prepare_at         timestamptz;

notify pgrst, 'reload schema';

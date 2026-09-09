-- Module « Chantiers » (Olivier 09/09/2026) : le tableau des chantiers VD Soft
-- vit DANS l'app, visibilité superadmin — plus dans un artefact à part.
-- « Refais mon tableau correctement sinon on ne peut pas travailler. »
--
-- Quatre statuts : cours (on y travaille), attente (bloqué : décision,
-- migration, information), fini (livré et déployé), dormant (ouvert, pas
-- repris — à arbitrer). Chaque changement laisse une ligne de journal, pour
-- qu'on voie ce qui a bougé et quand.
--
-- Tables lues UNIQUEMENT côté serveur (service_role) : RLS activé sans policy,
-- aucun droit pour anon/authenticated — même recette que 202609082330.

CREATE TABLE IF NOT EXISTS chantiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE,                       -- clé stable pour les semis (nullable pour les créations à la main)
  title       text NOT NULL,
  tag         text,                              -- Facturation, Saisie, Chauffeur…
  status      text NOT NULL DEFAULT 'attente' CHECK (status IN ('cours', 'attente', 'fini', 'dormant')),
  note        text,
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
CREATE INDEX IF NOT EXISTS idx_chantiers_status ON chantiers (status, position);

CREATE TABLE IF NOT EXISTS chantier_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id uuid REFERENCES chantiers(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text,
  text        text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chantier_logs_at ON chantier_logs (at DESC);

ALTER TABLE chantiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chantier_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE chantiers, chantier_logs FROM anon, authenticated, public;
GRANT  ALL ON TABLE chantiers, chantier_logs TO service_role, postgres;

-- ── Semis : l'état audité du 09/09/2026 ─────────────────────────────────────
-- Statuts d'après le dépôt (dernier commit par zone) et les réponses d'Olivier :
-- menu navigable pas satisfaisant, ventes et site en stand-by, éclatement OK.
INSERT INTO chantiers (key, title, tag, status, note, position) VALUES
  -- En cours
  ('vue-dossier',   'Vue dossier & Facturation par dossier', 'Dossier',     'cours',   'Le chantier principal des trois dernières semaines : 68 commits depuis le 26/08. Fiche unifiée, modale Facturer partagée, audit de parité. Flag dossier_view encore dans le code.', 10),
  ('flux2',         'Flux 2 — clôture unifiée',              'Chauffeur',   'cours',   'Activation par la grille chauffeur × assistance (/admin/flux2). L''ancien flux reste dans le code comme repli : il n''est pas remplacé tant qu''une case n''est pas cochée.', 20),
  ('onsite',        'Refonte du flux sur place',             'Chauffeur',   'cours',   'Écran « Qu''est-ce qu''on fait ? ». Toujours derrière le drapeau driver_onsite_v2. Encaissement privé à valider en réel.', 30),
  ('vab',           'VAB — fiabilisation',                   'Intégration', 'cours',   '16 commits depuis le 26/08, dernier le 07/09 : filet, clôtures multiples, actions par AssignmentId.', 40),
  ('saisies',       'Fourrière — saisies & Parquet',         'Saisie',      'cours',   'Dernier le 09/09 : un mail de refus du Parquet n''est plus lu comme un accord ; bouton « Renvoyer corrigé ».', 50),
  ('gard2',         'Découpe du gardiennage à la levée',     'Saisie',      'cours',   'Deux groupes : saisie jusqu''à la levée (SPF), puis tarif « autre » au client. Déployé le 09/09, à éprouver sur un vrai dossier.', 60),
  ('hardcode',      'Admin sans valeurs en dur',             'Socle',       'cours',   'Phase 2 : sortir sources, motifs et libellés du code. Avancement à confirmer — pas de mesure fiable dans le dépôt.', 70),
  -- En attente
  ('mig-payer',     'Migration : question du payeur à la levée', 'Migration', 'attente', '202609091700_levee_saisie_payer.sql — à passer dans Supabase, sinon la réponse ne s''enregistre pas.', 10),
  ('mig-kaze',      'Migration : coordonnées Kaze',          'Migration',   'attente', '202609091500_kaze_incident_coords_backfill.sql — rattrape les fiches Kaze sans coordonnées.', 20),
  ('nav',           'Menu navigable',                        'App',         'attente', 'Version actuelle jugée pas satisfaisante (Olivier 09/09). À repenser avant d''aller plus loin. Rien touché depuis le 20/08.', 30),
  ('ventes',        'Ventes de véhicules',                   'Ventes',      'attente', 'Stand-by (Olivier 09/09). Module et pages publiques prêts depuis le 20/08.', 40),
  ('site',          'Site public — contenus',                'Site',        'attente', 'Stand-by (Olivier 09/09). Squelette et pages légales posés le 24/08.', 50),
  ('acalculer',     '« À calculer » restants',               'Facturation', 'attente', 'La raison s''affiche maintenant sur la carte. L''envoyer pour corriger la vraie cause.', 60),
  ('photos-tow',    'Photos d''archive TowSoft',              'Migration',   'attente', 'Drapeau actif, récupération repoussée à après la mise en production.', 70),
  ('axa-mobile',    'AXA — identifiant mobile',              'Intégration', 'attente', 'client_id de leur app à capturer pour compléter l''authentification.', 80),
  ('etiquettes',    'Étiquettes parc',                       'Fourrière',   'attente', 'Migration partielle : mal garée en chargement, rodéo et AVP restent à basculer.', 90),
  ('garage-notif',  'Annulation garage — notification',      'Garage',      'attente', 'La notification aux dispatchers n''est pas branchée.', 100),
  -- Terminé
  ('extraits',      'Éclatement des extraits bancaires',     'Finance',     'fini',    'Fonctionne (Olivier 09/09). Dernier correctif le 31/08.', 10),
  ('requisitoire',  'Réquisitoires — étanchéité gardiennage','Fourrière',   'fini',    'Audit complet du 08/09 : 44 lecteurs de missions rendus étanches aux fiches Gardiennage.', 20),
  ('tvac',          'Montant TVAC sur les cartes',           'Facturation', 'fini',    'Par groupe, par dossier et sur le total. TVA 21 %.', 30),
  ('encaisse',      'Encaissement chauffeur visible',        'Facturation', 'fini',    'Pastille sur la carte + détail (mode, chauffeur, date) dans le panneau déplié.', 40),
  ('touring',       'Filtre Touring sur le payeur',          'Facturation', 'fini',    '« Hors Touring » exclut tout ce qui lui est facturé, Siabis Couvert compris.', 50),
  ('compteur',      'Compteur de groupe aligné',             'Facturation', 'fini',    'Il annonce ce qu''on verra en cliquant : même onglet, même source, même recherche.', 60),
  ('client-dbl',    'Client du dossier — double saisie',     'Dossier',     'fini',    'Le recalcul de fond écrasait l''enregistrement. Toute réponse périmée est ignorée.', 70),
  ('progressif',    'Page facturation — calcul progressif',  'Performance', 'fini',    '24 s d''attente → page immédiate, montants qui se posent ligne par ligne.', 80),
  ('levee-q',       'Levée : qui paie les frais ?',          'Saisie',      'fini',    'Question posée à la levée définitive, réponse enregistrée et faisant foi.', 90),
  ('kaze-coord',    'Kaze — coordonnées conservées',         'Intégration', 'fini',    'L''import lisait la position d''intervention sans jamais l''écrire.', 100),
  ('moteur-err',    'Erreur moteur ≠ pas de tarif',          'Facturation', 'fini',    'Une requête qui tombe ne se lit plus comme un verdict tarifaire.', 110)
ON CONFLICT (key) DO NOTHING;

INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Tableau reconstruit d''après l''audit du dépôt (212 commits depuis le 26/08) et les réponses d''Olivier.'
FROM chantiers WHERE key = 'vue-dossier';

NOTIFY pgrst, 'reload schema';

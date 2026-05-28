// Catalog des fonctions a tester par le testeur externe (Jona).
// Olivier 2026-05-28 : reprend la numerotation de l audit complet du 28/05.
// Ordre logique : commun -> dispatcher (cree les missions) -> driver (les execute)
// -> fourriere -> facturation -> encaissement bureau.
// NB : l auto-dispatch n est pas encore operationnel, il est exclu des tests.

export interface TestFunction {
  id:          string         // numero stable
  label:       string         // titre court
  description: string         // a quoi sert cette fonction
  procedure:   string[]       // etapes a suivre (numerotees)
  permissions: string         // qui peut tester (info)
  tip?:        string         // hint optionnel
}

export interface TestSection {
  id:        string
  title:     string
  emoji:     string
  functions: TestFunction[]
}

export const TEST_CATALOG: TestSection[] = [
  // ─────────────────────────────────────────────────────────────
  {
    id: 'commun',
    title: 'Fonctions communes',
    emoji: '👤',
    functions: [
      {
        id: '1', label: 'Voir le Dashboard',
        description: 'Écran d\'accueil avec widgets actifs (missions, encaissements, raccourcis).',
        procedure: [
          'Connecte-toi à l\'app VD Soft (login + mot de passe ou Apple Sign-in)',
          'Tu dois arriver directement sur le Dashboard',
          'Vérifie la présence des widgets selon ton rôle',
          'Teste les liens / boutons des widgets',
        ],
        permissions: 'Tous les utilisateurs',
      },
      {
        id: '2', label: 'Recherche globale',
        description: 'Cherche n\'importe quoi dans l\'app (plaque, mission, client, etc.).',
        procedure: [
          'Clique sur l\'icône 🔍 dans la sidebar gauche, OU appuie sur Cmd+K',
          'Tape une plaque ou un numéro de mission (ex: "1ABC234" ou "10000535")',
          'Les résultats doivent s\'afficher en temps réel, classés par catégorie',
          'Clique un résultat pour ouvrir la fiche',
        ],
        permissions: 'Tous les utilisateurs',
      },
      {
        id: '3', label: 'Voir et modifier son profil',
        description: 'Page profil avec nom, email, avatar, préférences.',
        procedure: [
          'Clique sur ton nom en bas à gauche de la sidebar',
          'Vérifie que tu arrives sur /profil',
          'Modifie ton nom ou ta photo',
          'Vérifie que la sauvegarde est automatique (pas de bouton "Enregistrer")',
        ],
        permissions: 'Tous les utilisateurs',
      },
      {
        id: '4', label: 'Changer son mot de passe',
        description: 'Onglet Sécurité dans le profil.',
        procedure: [
          'Va sur /profil → onglet "Sécurité" ou bouton "Changer mot de passe"',
          'Saisis le mot de passe actuel + nouveau (2 fois)',
          'Vérifie le message de succès',
        ],
        permissions: 'Tous les utilisateurs (sauf Sign-in Apple)',
      },
      {
        id: '5', label: 'Personnaliser l\'ordre du menu',
        description: 'Drag & drop des items de la sidebar.',
        procedure: [
          'Va sur /profil',
          'Section "Ordre du menu"',
          'Glisse-déplace les items dans un ordre différent',
          'Recharge la page et vérifie que l\'ordre est conservé',
        ],
        permissions: 'Tous les utilisateurs',
        tip: 'Tu peux mettre en tête les pages que tu utilises le plus souvent',
      },
      {
        id: '6', label: 'Notifications push',
        description: 'Push iOS pour missions, encaissements, alertes.',
        procedure: [
          'Active les notifications dans iOS Réglages → VD Soft → Notifications',
          'Demande à un dispatcher de t\'assigner une mission test',
          'Vérifie que tu reçois la notif push',
          'Tape la notif pour ouvrir directement la mission',
        ],
        permissions: 'Tous les utilisateurs',
      },
      {
        id: '7', label: 'Scanner un QR d\'étiquette parc',
        description: 'Hub mission accessible par scan QR.',
        procedure: [
          'Trouve une étiquette parc imprimée (ex: sur un véhicule en parc)',
          'Ouvre l\'app Appareil photo iOS',
          'Pointe vers le QR (peut être à distance, ex: depuis un Clark)',
          'Une notif "Ouvrir dans Safari" apparaît → tape',
          'Le Hub mission s\'ouvre avec la carte véhicule + boutons selon tes permissions',
        ],
        permissions: 'Tous les utilisateurs',
        tip: 'Le QR contient une URL /qr/mission/[numero]. Tu peux aussi le tester directement en allant sur cette URL.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CASQUETTE DISPATCHER : on cree d abord les missions (input du process)
  {
    id: 'dispatcher',
    title: 'Dispatcher — Gestion',
    emoji: '📡',
    functions: [
      {
        id: '50', label: 'Tableau de bord dispatch',
        description: 'Vue d\'ensemble des missions actives.',
        procedure: [
          'Clique sur 📡 "Dispatch" dans la sidebar',
          'Vérifie que tu vois la liste des missions actives',
          'Compteurs en haut visibles',
          'Sources avec couleurs visibles sur chaque carte',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '54', label: 'Rechercher une mission',
        description: 'Barre de recherche dans le dispatch.',
        procedure: [
          'Dans la barre de recherche du dispatch, tape une plaque',
          'Vérifie que le filtre est live',
          'Test aussi avec un numéro de mission (#10000XXX)',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '61', label: 'Confirmer / Refuser une mission en "new"',
        description: 'Validation des missions parsées depuis email.',
        procedure: [
          'Trouve une mission en statut "new" dans /dispatch?status=new',
          'Ouvre sa fiche',
          'Test "✅ Confirmer la mission" → passe en "dispatching"',
          'Pour une autre, test "✗ Refuser" → passe en "ignored"',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '62', label: 'Assigner un chauffeur manuellement',
        description: 'Sélecteur chauffeur sur la fiche dispatch.',
        procedure: [
          'Sur une fiche mission "dispatching", bloc "Assignation chauffeur"',
          'Choisis un chauffeur',
          'Vérifie push notif envoyée au chauffeur',
          'Mission passe en "assigned"',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '68', label: 'Imprimer une étiquette parc',
        description: 'Bouton imprimer depuis la fiche dispatch.',
        procedure: [
          'Sur une fiche dispatch en parc, bouton "🖨️ Imprimer l\'étiquette parc"',
          'Clique → confirmation "Étiquette envoyée"',
          'Vérifie physiquement que l\'étiquette sort de la Zebra',
        ],
        permissions: 'Dispatcher / Admin / Module fourriere',
      },
      {
        id: '75', label: 'Créer une mission manuelle',
        description: 'Formulaire complet depuis dispatch.',
        procedure: [
          'Bouton "+ Créer une mission" dans le dispatch',
          'Remplis : source, type, véhicule, adresses, client',
          'Soumets',
          'Vérifie qu\'elle apparaît en "dispatching"',
        ],
        permissions: 'Dispatcher / Admin',
        tip: 'Crée plusieurs missions test (Police Mal Garée, Appel Privé DSP, Appel Privé REM) pour que tu puisses les exécuter ensuite avec la casquette Driver.',
      },
      {
        id: '87', label: 'Créer une relivraison (REL)',
        description: 'Bouton Relivrer sur fiche dispatch d\'une mission parquée.',
        procedure: [
          'Sur une fiche mission "parked" en zone Transit (SNC ou Privé depot)',
          'Bloc "Véhicule en parc" en haut de la colonne droite',
          'Saisis l\'adresse de relivraison (autocomplete Google)',
          'Bouton "🚛 Créer la mission de relivraison"',
          'Confirme → redirection automatique vers nouvelle fiche REL',
        ],
        permissions: 'Dispatcher / Admin',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CASQUETTE DRIVER : execute les missions creees par le dispatcher
  {
    id: 'driver-list',
    title: 'Chauffeur — Liste & navigation',
    emoji: '🚗',
    functions: [
      {
        id: '10', label: 'Voir liste "Mes Missions"',
        description: 'Liste des missions assignées au chauffeur, classées par statut.',
        procedure: [
          'Clique sur 🚗 "Mes Missions" dans la sidebar',
          'Vérifie que tu vois 2 sections : "En cours" et "Terminées"',
          'Compteur de missions visible',
          'Clique une mission pour ouvrir sa fiche',
        ],
        permissions: 'Driver',
      },
      {
        id: '11', label: 'Voir détails d\'une mission',
        description: 'Fiche mission avec infos véhicule, adresses, actions.',
        procedure: [
          'Depuis "Mes Missions", clique sur une mission',
          'Vérifie la présence des 4 blocs : Infos mission, Adresses, Actions, Encaissement',
          'Test des liens d\'adresses (doit ouvrir Apple Plans ou Google Maps)',
        ],
        permissions: 'Driver',
      },
      {
        id: '12', label: 'Filtrer mes missions',
        description: 'Onglets En cours / Terminées.',
        procedure: [
          'Sur /mission, alterne entre les 2 onglets',
          'Vérifie que le filtre fonctionne',
          'Compteurs corrects',
        ],
        permissions: 'Driver',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'driver-create',
    title: 'Chauffeur — Création de missions',
    emoji: '➕',
    functions: [
      {
        id: '13', label: 'Créer une mission Police',
        description: 'Formulaire complet pour création mission Police (Accident, Saisie, Rodéo, Mal Garée, etc.).',
        procedure: [
          'Va sur /mission/police',
          'Sélectionne le type "🚫 Mal Garée"',
          'Remplis : date/heure (auto), véhicule (plaque + marque), intervention (adresse avec autocomplete)',
          'Choisis le scénario (Chargement / Déplacement avec paiement)',
          'Soumets la mission',
          'Vérifie qu\'elle apparaît dans /dispatch (côté admin)',
        ],
        permissions: 'Driver',
      },
      {
        id: '15', label: 'Mal Garée : scénario "Déplacement avec paiement" (125€)',
        description: 'Workflow encaissement obligatoire avant clôture.',
        procedure: [
          'Crée une mission Mal Garée',
          'Sélectionne "💳 Déplacement avec paiement"',
          'Vérifie que le bloc "Blocage police" disparaît',
          'Bouton submit doit afficher "💳 Créer et encaisser"',
          'Clique → redirection automatique vers /encaissement',
          'Vérifie que plaque, marque, modèle, 125€, adresse, motif "Mal Garée" sont précomplétés',
          'Pas de bouton "Plus tard" disponible (encaissement obligatoire)',
        ],
        permissions: 'Driver',
      },
      {
        id: '16', label: 'Appel Privé DSP/REM + destination',
        description: 'Type d\'intervention + destination + forfait.',
        procedure: [
          'Crée une mission Appel Privé',
          'Choisis "REM" → vérifie l\'apparition du sélecteur "Destination"',
          'Test "Livraison directe client" → champ adresse destination devient OBLIGATOIRE',
          'Test "Passage dépôt" → champ adresse facultatif',
          'Saisis un forfait (ex: 150) → vérifie le tarif estimé live',
          'Vérifie que le tarif TVAC = 150,00€ (pas 150,01)',
        ],
        permissions: 'Driver',
      },
      {
        id: '18', label: 'Autocomplete Google adresses',
        description: 'Tous les champs adresse utilisent Google Places.',
        procedure: [
          'Sur n\'importe quel formulaire, clique dans un champ adresse',
          'Tape "Rue de Verviers"',
          'Des propositions doivent apparaître',
          'Sélectionne-en une → l\'adresse complète + GPS doivent être remplis',
        ],
        permissions: 'Tous',
      },
      {
        id: '19', label: 'Scanner plaque/VIN avec caméra (OCR)',
        description: 'Bouton 📷 à côté des champs plaque et VIN.',
        procedure: [
          'Sur le formulaire véhicule, clique sur 📷 à côté de "Plaque"',
          'Pointe la caméra vers une plaque',
          'Vérifie que le texte est reconnu et inséré',
          'Idem pour le VIN',
        ],
        permissions: 'Driver',
      },
      {
        id: '20', label: 'Lookup véhicule Odoo par plaque',
        description: 'Auto-recherche véhicule existant Odoo via plaque.',
        procedure: [
          'Saisis une plaque existante dans Odoo (demande à Olivier une plaque test)',
          'Clique en dehors du champ (onBlur)',
          'Vérifie qu\'une modal s\'ouvre ou que les champs marque/modèle se remplissent',
        ],
        permissions: 'Driver',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'driver-workflow',
    title: 'Chauffeur — Workflow mission',
    emoji: '🏁',
    functions: [
      {
        id: '25', label: 'Accepter / Refuser une mission',
        description: 'Boutons sur la fiche mission après assignation.',
        procedure: [
          'Demande à un dispatcher de t\'assigner une mission test',
          'Tu reçois notif push',
          'Sur la fiche, teste "✓ Accepter" → statut passe à "accepted"',
          'Pour une autre mission, teste "✗ Refuser" → mission retourne au dispatcher',
        ],
        permissions: 'Driver',
      },
      {
        id: '26', label: 'Marquer "En route"',
        description: 'Active la géolocalisation pour le dispatcher.',
        procedure: [
          'Sur une mission acceptée, bouton "🚗 En route"',
          'Accepte la demande iOS de géolocalisation',
          'Statut doit passer à "in_progress"',
        ],
        permissions: 'Driver',
      },
      {
        id: '28', label: 'Ajouter des photos',
        description: 'Catégorise les photos : VIN, Km, Dégât, Signature.',
        procedure: [
          'Sur la fiche mission, bouton "📷 Ajouter photo"',
          'Prends une photo test',
          'Catégorise-la (VIN, Km, etc.)',
          'Vérifie que la photo apparaît dans la galerie de la fiche',
        ],
        permissions: 'Driver',
      },
      {
        id: '29', label: 'Mettre le véhicule en parc',
        description: 'Bouton "Mise en parc" avec sélection zone.',
        procedure: [
          'Sur une mission "sur place" ou "en cours"',
          'Bouton "🅿️ Mise en parc"',
          'Sélectionne une zone (A ou Transit pour driver)',
          'Mission passe en "parked"',
        ],
        permissions: 'Driver',
      },
      {
        id: '30', label: 'Clôturer une mission (DSP/REM/DPR)',
        description: 'Bouton Terminer avec type final + photos + signature.',
        procedure: [
          'Sur une mission "in_progress" ou "parked"',
          'Bouton "🏁 Terminer"',
          'Choisis le type final (DSP/REM/REL/DPR)',
          'Pour DPR : motif obligatoire',
          'Ajoute photos + signature',
          'Mission passe en "to_invoice"',
        ],
        permissions: 'Driver',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'driver-encaissement',
    title: 'Chauffeur — Encaissement',
    emoji: '💳',
    functions: [
      {
        id: '40', label: 'Encaisser un client lié à une mission',
        description: 'Bouton Encaisser sur la fiche mission.',
        procedure: [
          'Sur une fiche mission, clique "💳 Ouvrir l\'encaissement"',
          'Vérifie que tout est précomplété (plaque, brand, model, montant, adresse, motif)',
          'Choisis un mode de paiement (cash recommandé pour test)',
          'Valide',
          'Reçu email doit partir si client_email présent',
          'Retour fiche mission → badge "✅ Payée"',
        ],
        permissions: 'Driver',
      },
      {
        id: '43', label: 'Restituer un véhicule avec paiement (via QR)',
        description: 'Scan QR → Hub → bouton Restituer.',
        procedure: [
          'Scanne le QR d\'une étiquette parc',
          'Sur le Hub, vérifie le bouton "💳 Restituer (avec paiement)"',
          'Clique → redirection vers /encaissement précomplété',
          'Vérifie que adresse et motif sont remplis',
          'Procède à l\'encaissement',
        ],
        permissions: 'Tous',
      },
      {
        id: '44', label: 'Restituer sans frais',
        description: 'Modal motif obligatoire.',
        procedure: [
          'Sur le Hub QR, bouton "🆓 Restituer sans frais"',
          'Modal apparaît demandant le motif',
          'Saisis un motif test',
          'Confirme',
          'Mission passe en "completed" avec no_charge_reason en BD',
        ],
        permissions: 'Tous',
      },
      {
        id: '45', label: 'Prendre une REL via scan QR',
        description: 'Modal de confirmation avec adresse de relivraison.',
        procedure: [
          'Sur le Hub QR d\'une mission éligible REL (REM+REL en parc ou SNC depot)',
          'Bouton "🚛 Relivrer ce véhicule"',
          'Vérifie qu\'une modal de confirmation apparaît avec véhicule + adresse',
          'Confirme → REL est créée et tu es assigné',
        ],
        permissions: 'Driver (sinon dispatcher avec sélecteur chauffeur)',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'fourriere',
    title: 'Fourrière',
    emoji: '🚓',
    functions: [
      {
        id: '100', label: 'Voir liste véhicules en fourrière',
        description: 'Liste par zone.',
        procedure: [
          'Clique sur 🚓 "Fourrière" dans la sidebar',
          'Vérifie que les véhicules sont regroupés par zone',
          'Compteurs corrects',
        ],
        permissions: 'Module fourriere / Admin',
      },
      {
        id: '101', label: 'Plan visuel du parc',
        description: 'Drag & drop des emplacements.',
        procedure: [
          'Va sur /fourriere/plan',
          'Test drag & drop d\'un véhicule d\'une case à une autre',
          'Vérifie la sauvegarde automatique (recharger la page)',
        ],
        permissions: 'Module fourriere / Admin',
      },
      {
        id: '110', label: 'Transférer un véhicule vers une autre zone',
        description: 'Via Hub QR : bouton Transférer.',
        procedure: [
          'Scanne le QR d\'une étiquette',
          'Bouton "🚛 Transférer vers une zone"',
          'Choisis une zone cible',
          'Vérifie la suggestion auto rangée + slot',
          'Confirme → véhicule transféré',
        ],
        permissions: 'Module fourriere / Admin',
      },
      {
        id: '120', label: 'Restituer un véhicule avec paiement (3 modes)',
        description: 'Modal RestituerMalGareeModal.',
        procedure: [
          'Sur fiche dispatch d\'une mission "parked" Mal Garée/Rodéo',
          'Bouton "🔑 Restituer le véhicule"',
          'Modal s\'ouvre avec calcul auto forfait + km + gardiennage',
          'Test Mode Invoice (si tu as clé API Odoo), Driver cash, ou No charge',
          'Confirme',
        ],
        permissions: 'Module fourriere / Admin',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'facturation',
    title: 'Facturation',
    emoji: '🧾',
    functions: [
      {
        id: '130', label: 'Voir liste missions à facturer',
        description: 'Page /facturation.',
        procedure: [
          'Clique sur 🧾 "Facturation"',
          'Vérifie la liste des missions en statut "to_invoice"',
          'Vérifie le badge "X€ encaissé" sur les missions avec paiement',
          'Tri chronologique fonctionne',
        ],
        permissions: 'Module facturation / Admin',
      },
      {
        id: '132', label: 'Modal de facturation',
        description: 'Sections groupées + préparation devis.',
        procedure: [
          'Clique "Facturer →" sur une mission',
          'Modal FacturerModal s\'ouvre',
          'Vérifie les sections : Mission, Client, Lignes devis, Encaissements liés',
          'Test la modification d\'une quantité',
        ],
        permissions: 'Module facturation / Admin',
      },
      {
        id: '133', label: 'Créer un devis Odoo',
        description: 'Action principale de facturation.',
        procedure: [
          'Dans la modal de facturation, sélectionne le partner Odoo',
          'Vérifie les lignes auto (forfait + km + gardiennage)',
          'Bouton "Créer devis Odoo"',
          'Vérifie que le devis apparaît dans Odoo (brouillon)',
        ],
        permissions: 'Module facturation / Admin',
        tip: 'Pour tester, prends une mission test avec un partner non important.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'encaissement',
    title: 'Encaissement bureau',
    emoji: '💰',
    functions: [
      {
        id: '145', label: 'Encaissement standalone (passage caisse)',
        description: 'Page /encaissement sans mission liée.',
        procedure: [
          'Va sur /encaissement directement (pas depuis une mission)',
          'Saisis une plaque connue',
          'Continue le workflow (vehicule → motif → adresse → paiement → client)',
          'Valide',
        ],
        permissions: 'Module encaissement',
      },
      {
        id: '146', label: 'Auto-détection mission ouverte par plaque',
        description: 'Bandeau vert si mission trouvée.',
        procedure: [
          'Sur /encaissement, saisis la plaque d\'une mission en parc actuellement',
          'Vérifie qu\'un bandeau vert apparaît "Mission ouverte trouvée"',
          'Clique "💳 Encaisser cette mission →"',
          'Redirection vers encaissement précomplété',
        ],
        permissions: 'Module encaissement',
      },
    ],
  },
]

/**
 * Aplatit le catalog en liste de fonctions (utile pour comptage / iteration).
 */
export function allTestFunctions(): TestFunction[] {
  return TEST_CATALOG.flatMap(s => s.functions)
}

/**
 * Total des fonctions a tester.
 */
export const TOTAL_TESTS = allTestFunctions().length

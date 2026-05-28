// Catalog des fonctions a tester par le testeur externe (Jona).
// Olivier 2026-05-28 : redige pour un utilisateur lambda, sans jargon.
// Ordre logique : commun -> dispatcher (cree les missions) -> driver (les execute)
// -> fourriere -> facturation -> encaissement bureau.
// NB : auto-dispatch exclu (pas operationnel).
// CONSIGNES TEST : toujours utiliser la plaque "TEST" (plusieurs vehicules
// existent volontairement avec cette plaque pour montrer le selecteur multi),
// et toujours ecrire "test" dans le champ remarque.

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
    title: 'Pour commencer',
    emoji: '👤',
    functions: [
      {
        id: '1', label: 'Se connecter et voir l\'accueil',
        description: 'L\'écran d\'accueil affiche tes raccourcis et un résumé selon ton rôle.',
        procedure: [
          'Ouvre l\'app VD Soft',
          'Connecte-toi (email + mot de passe, ou bouton "Continuer avec Apple")',
          'Tu arrives sur la page d\'accueil',
          'Regarde les blocs affichés : missions du jour, encaissements récents, raccourcis',
          'Clique un raccourci pour vérifier qu\'il t\'amène bien à la bonne page',
        ],
        permissions: 'Tout le monde',
      },
      {
        id: '2', label: 'Faire une recherche',
        description: 'La loupe permet de chercher n\'importe quoi : un véhicule, un client, une mission.',
        procedure: [
          'Clique sur la loupe 🔍 dans le menu de gauche',
          'Tape "TEST" pour chercher les véhicules test',
          'Les résultats s\'affichent en temps réel, classés par catégorie',
          'Clique sur un résultat pour ouvrir sa fiche',
        ],
        permissions: 'Tout le monde',
        tip: 'Astuce clavier : Cmd+K (Mac) ou Ctrl+K (Windows) ouvre la recherche directement.',
      },
      {
        id: '3', label: 'Voir et modifier ton profil',
        description: 'Ton nom, ta photo, tes préférences personnelles.',
        procedure: [
          'Clique sur ton nom en bas à gauche du menu',
          'Tu arrives sur ta page profil',
          'Change ton nom ou ta photo',
          'Vérifie qu\'il n\'y a pas besoin de cliquer sur "Enregistrer" (sauvegarde automatique)',
        ],
        permissions: 'Tout le monde',
      },
      {
        id: '4', label: 'Changer ton mot de passe',
        description: 'Onglet Sécurité dans le profil.',
        procedure: [
          'Va sur ta page profil',
          'Clique sur "Sécurité" ou "Changer mot de passe"',
          'Tape ton ancien mot de passe, puis le nouveau deux fois',
          'Vérifie le message de confirmation',
        ],
        permissions: 'Tout le monde (sauf connexion Apple)',
      },
      {
        id: '5', label: 'Personnaliser l\'ordre du menu',
        description: 'Tu peux glisser-déposer les items du menu de gauche dans l\'ordre que tu préfères.',
        procedure: [
          'Va sur ta page profil',
          'Trouve la section "Ordre du menu"',
          'Glisse-dépose les items dans un nouvel ordre',
          'Recharge la page : l\'ordre doit être conservé',
        ],
        permissions: 'Tout le monde',
        tip: 'Mets en tête les pages que tu utilises le plus souvent.',
      },
      {
        id: '6', label: 'Recevoir une notification',
        description: 'Les alertes importantes arrivent directement sur ton iPhone.',
        procedure: [
          'Active les notifications dans Réglages iPhone → VD Soft → Notifications',
          'Demande qu\'on t\'assigne une mission test',
          'Vérifie que tu reçois bien l\'alerte sur ton iPhone',
          'Tape sur l\'alerte : elle doit ouvrir directement la mission',
        ],
        permissions: 'Tout le monde',
      },
      {
        id: '7', label: 'Scanner une étiquette de véhicule',
        description: 'Chaque véhicule en parc a une étiquette avec un QR. Le scanner ouvre directement sa fiche.',
        procedure: [
          'Trouve une étiquette imprimée sur un véhicule en parc',
          'Ouvre l\'appareil photo de ton iPhone',
          'Vise le QR (tu peux être à distance, depuis un Clark par exemple)',
          'Une notification "Ouvrir dans Safari" apparaît',
          'Tape dessus : la fiche du véhicule s\'ouvre avec les boutons d\'action disponibles selon ton rôle',
        ],
        permissions: 'Tout le monde',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CASQUETTE DISPATCHER : cree d abord les missions (input du process)
  {
    id: 'dispatcher',
    title: 'Casquette Dispatcher',
    emoji: '📡',
    functions: [
      {
        id: '50', label: 'Voir le tableau Dispatch',
        description: 'Vue d\'ensemble de toutes les missions actives.',
        procedure: [
          'Clique sur "Dispatch" dans le menu de gauche',
          'Vérifie que la liste des missions s\'affiche',
          'Regarde les compteurs en haut (combien de missions par statut)',
          'Chaque carte mission a une couleur selon sa provenance (Touring, Ethias, etc.)',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '54', label: 'Rechercher une mission',
        description: 'Barre de recherche en haut du tableau Dispatch.',
        procedure: [
          'Dans la barre de recherche, tape "TEST"',
          'Le filtre s\'applique en direct',
          'Essaye aussi avec un numéro de mission (ex: #10000XXX)',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '61', label: 'Confirmer ou refuser une mission entrante',
        description: 'Les missions reçues par mail (assurances, etc.) arrivent en "À confirmer". Tu valides ou tu refuses.',
        procedure: [
          'Trouve une mission à confirmer dans le tableau (filtre "À confirmer")',
          'Clique pour ouvrir sa fiche',
          'Vérifie les infos puis clique "✅ Confirmer la mission"',
          'Pour une autre, teste "✗ Refuser" (la mission sort du tableau)',
        ],
        permissions: 'Dispatcher / Admin',
        tip: 'Avant de confirmer, vérifie les alertes (véhicule électrique, péri, etc.) : le chauffeur les verra.',
      },
      {
        id: '62', label: 'Assigner un chauffeur',
        description: 'Choisir qui va aller faire la mission.',
        procedure: [
          'Sur une fiche mission à dispatcher, trouve le bloc "Assignation chauffeur" (colonne droite)',
          'Ouvre le sélecteur et choisis un chauffeur',
          'Le chauffeur reçoit aussitôt une notification sur son iPhone',
          'La mission passe en "Assignée"',
        ],
        permissions: 'Dispatcher / Admin',
      },
      {
        id: '68', label: 'Imprimer une étiquette parc',
        description: 'Bouton pour envoyer l\'étiquette directement à l\'imprimante Zebra.',
        procedure: [
          'Sur une fiche mission dont le véhicule est en parc',
          'Clique "🖨️ Imprimer l\'étiquette parc"',
          'Tu vois "Étiquette envoyée"',
          'Va vérifier que l\'étiquette sort bien de l\'imprimante',
        ],
        permissions: 'Dispatcher / Admin / Module fourrière',
      },
      {
        id: '75', label: 'Créer une mission manuellement',
        description: 'Quand un appel arrive et qu\'il faut créer la mission à la main.',
        procedure: [
          'Dans Dispatch, clique "+ Créer une mission"',
          'Plaque : tape "TEST" → le sélecteur multi-véhicule doit apparaître (on a plusieurs véhicules avec cette plaque exprès, pour démontrer le cas)',
          'Choisis un véhicule dans la liste',
          'Remplis l\'adresse (utilise l\'autocomplete Google)',
          'Choisis le client',
          'Dans la remarque, écris "test"',
          'Valide → la mission apparaît dans le tableau',
        ],
        permissions: 'Dispatcher / Admin',
        tip: 'Crée plusieurs missions test (différents types : Mal Garée, Appel Privé DSP, Appel Privé REM) pour avoir de quoi faire avec la casquette Chauffeur ensuite.',
      },
      {
        id: '87', label: 'Préparer une relivraison',
        description: 'Quand un véhicule en parc doit être livré au garage du client.',
        procedure: [
          'Trouve une mission dont le véhicule est en parc (zone Transit)',
          'Dans la fiche, repère le bloc "Véhicule en parc" en haut à droite',
          'Tape l\'adresse de livraison (autocomplete Google)',
          'Clique "🚛 Créer la mission de relivraison"',
          'Tu es redirigé vers la nouvelle mission créée',
        ],
        permissions: 'Dispatcher / Admin',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CASQUETTE DRIVER : execute les missions creees par le dispatcher
  {
    id: 'driver-list',
    title: 'Casquette Chauffeur — Mes missions',
    emoji: '🚗',
    functions: [
      {
        id: '10', label: 'Voir mes missions',
        description: 'La liste de toutes les missions qui te sont attribuées.',
        procedure: [
          'Clique sur "Mes Missions" dans le menu de gauche',
          'Tu vois deux onglets : "En cours" et "Terminées"',
          'Un compteur indique combien de missions sont en attente',
          'Clique sur une mission pour ouvrir sa fiche',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '11', label: 'Ouvrir le détail d\'une mission',
        description: 'La fiche mission regroupe toutes les infos et tous les boutons d\'action.',
        procedure: [
          'Depuis Mes Missions, clique sur une mission',
          'Vérifie que tu vois bien : les infos du véhicule, les adresses, les boutons d\'action, le bloc encaissement',
          'Clique sur une adresse : elle doit s\'ouvrir dans Plans (Apple) ou Google Maps',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '12', label: 'Basculer entre missions en cours et terminées',
        description: 'Onglets en haut de Mes Missions.',
        procedure: [
          'Sur Mes Missions, alterne entre les deux onglets',
          'Vérifie que la liste change',
          'Vérifie que les compteurs sont corrects',
        ],
        permissions: 'Chauffeur',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'driver-create',
    title: 'Casquette Chauffeur — Créer une mission',
    emoji: '➕',
    functions: [
      {
        id: '13', label: 'Créer une mission Police',
        description: 'Formulaire pour les missions Police (Accident, Saisie, Rodéo, Mal Garée, etc.).',
        procedure: [
          'Va sur "Nouvelle mission Police"',
          'Choisis le type "🚫 Mal Garée"',
          'Plaque : "TEST" (le sélecteur multi-véhicule doit apparaître, choisis-en un)',
          'Adresse d\'intervention : utilise l\'autocomplete Google',
          'Choisis le scénario (Chargement ou Déplacement avec paiement)',
          'Dans la remarque, écris "test"',
          'Valide la mission',
          'Demande à un dispatcher de vérifier qu\'elle apparaît bien dans son tableau',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '15', label: 'Mal Garée — Déplacement avec paiement (125€)',
        description: 'Le client paye 125€ pour qu\'on déplace son véhicule. L\'encaissement est obligatoire avant clôture.',
        procedure: [
          'Crée une mission Mal Garée (plaque TEST, remarque "test")',
          'Choisis le scénario "💳 Déplacement avec paiement"',
          'Vérifie que le bloc "Blocage police" disparaît',
          'Le bouton de validation doit dire "💳 Créer et encaisser"',
          'Clique : tu es redirigé directement vers l\'écran d\'encaissement',
          'Vérifie que plaque, marque, modèle, montant 125€, adresse et motif "Mal Garée" sont déjà remplis',
          'Vérifie qu\'il n\'y a pas de bouton "Plus tard" (l\'encaissement est obligatoire)',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '16', label: 'Appel Privé — DSP / REM + destination',
        description: 'Mission privée (le client paye directement). Tu choisis le type d\'intervention et la destination.',
        procedure: [
          'Crée une mission Appel Privé',
          'Plaque "TEST", remarque "test"',
          'Choisis "REM" (remorquage) : un sélecteur "Destination" doit apparaître',
          'Choisis "Livraison directe client" : le champ adresse destination devient obligatoire',
          'Bascule sur "Passage dépôt" : le champ adresse devient facultatif',
          'Tape un montant forfait (ex: 150) : le tarif estimé s\'affiche en direct',
          'Vérifie que le tarif TVAC affiché est bien 150,00€ (pas 150,01)',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '18', label: 'Autocomplete Google pour les adresses',
        description: 'Tous les champs adresse de l\'app utilisent Google Maps.',
        procedure: [
          'Sur n\'importe quel formulaire avec un champ adresse',
          'Clique dans le champ et tape "Rue de Verviers"',
          'Des suggestions doivent apparaître',
          'Choisis-en une : l\'adresse complète et la localisation GPS sont remplies automatiquement',
        ],
        permissions: 'Tout le monde',
      },
      {
        id: '19', label: 'Scanner une plaque ou un VIN avec la caméra',
        description: 'Bouton 📷 à côté des champs plaque et VIN : la caméra lit le numéro automatiquement.',
        procedure: [
          'Sur le formulaire véhicule, clique sur 📷 à côté de "Plaque"',
          'Vise la caméra vers une plaque',
          'Vérifie que le texte est reconnu et inséré dans le champ',
          'Fais la même chose avec le VIN',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '20', label: 'Reconnaissance automatique du véhicule par plaque',
        description: 'Quand tu tapes une plaque existante, l\'app retrouve automatiquement le véhicule.',
        procedure: [
          'Tape "TEST" comme plaque',
          'Clique en dehors du champ (ou appuie sur Tab)',
          'Une fenêtre doit s\'ouvrir avec la liste des véhicules trouvés',
          'Choisis-en un : marque, modèle et infos doivent se remplir automatiquement',
        ],
        permissions: 'Chauffeur',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'driver-workflow',
    title: 'Casquette Chauffeur — Faire une mission',
    emoji: '🏁',
    functions: [
      {
        id: '25', label: 'Accepter ou refuser une mission qui t\'est assignée',
        description: 'Quand un dispatcher t\'assigne une mission, tu reçois une notif et tu peux accepter ou refuser.',
        procedure: [
          'Demande à un dispatcher de t\'assigner une mission test',
          'Tu reçois une notification sur ton iPhone',
          'Ouvre la fiche mission',
          'Teste le bouton "✓ Accepter" : la mission passe en "Acceptée"',
          'Pour une autre mission, teste "✗ Refuser" : la mission repart vers le dispatcher',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '26', label: 'Indiquer que tu es en route',
        description: 'Active ta géolocalisation pour que le dispatcher te suive sur la carte.',
        procedure: [
          'Sur une mission acceptée, clique "🚗 En route"',
          'Accepte la demande de géolocalisation de ton iPhone',
          'La mission passe en "En cours"',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '28', label: 'Ajouter des photos à une mission',
        description: 'VIN, kilométrage, dégât, signature : tu peux classer chaque photo par catégorie.',
        procedure: [
          'Sur la fiche mission, clique "📷 Ajouter photo"',
          'Prends une photo (n\'importe quoi pour le test)',
          'Choisis sa catégorie (VIN, Km, Dégât, etc.)',
          'Vérifie qu\'elle apparaît bien dans la galerie de la fiche',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '29', label: 'Mettre un véhicule en parc',
        description: 'Quand tu déposes un véhicule au dépôt, tu choisis la zone.',
        procedure: [
          'Sur une mission "sur place" ou "en cours"',
          'Clique "🅿️ Mise en parc"',
          'Choisis une zone (A ou Transit, c\'est ce que les chauffeurs peuvent choisir)',
          'La mission passe en "En parc"',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '30', label: 'Clôturer une mission',
        description: 'Tu indiques comment la mission s\'est terminée et tu ajoutes photos + signature.',
        procedure: [
          'Sur une mission "En cours" ou "En parc"',
          'Clique "🏁 Terminer"',
          'Choisis le type final : Dépannage sur place (DSP), Remorquage (REM), Relivraison (REL), ou Refusé (DPR)',
          'Si tu choisis "Refusé" : tu dois préciser un motif',
          'Ajoute des photos et une signature',
          'La mission passe en "À facturer"',
        ],
        permissions: 'Chauffeur',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'driver-encaissement',
    title: 'Casquette Chauffeur — Encaisser',
    emoji: '💳',
    functions: [
      {
        id: '40', label: 'Encaisser un client depuis une mission',
        description: 'Bouton Encaisser sur la fiche mission : tout est précomplété.',
        procedure: [
          'Sur une fiche mission, clique "💳 Ouvrir l\'encaissement"',
          'Vérifie que tout est déjà rempli : plaque, marque, modèle, montant, adresse, motif',
          'Choisis un mode de paiement (cash pour le test)',
          'Valide',
          'Si le client a une adresse email : un reçu doit partir automatiquement',
          'Retour sur la fiche mission : un badge "✅ Payée" doit apparaître',
        ],
        permissions: 'Chauffeur',
      },
      {
        id: '43', label: 'Restituer un véhicule avec paiement (via QR)',
        description: 'Le client vient récupérer son véhicule. Tu scannes l\'étiquette et tu encaisses.',
        procedure: [
          'Scanne le QR d\'une étiquette parc',
          'Sur l\'écran qui s\'ouvre, repère le bouton "💳 Restituer (avec paiement)"',
          'Clique : tu es redirigé vers l\'écran d\'encaissement déjà rempli',
          'Vérifie que l\'adresse et le motif sont bien remplis',
          'Termine l\'encaissement',
        ],
        permissions: 'Tout le monde',
      },
      {
        id: '44', label: 'Restituer un véhicule sans frais',
        description: 'Cas où la restitution est gratuite : tu dois préciser le motif.',
        procedure: [
          'Sur l\'écran QR, clique "🆓 Restituer sans frais"',
          'Une fenêtre demande le motif',
          'Tape un motif de test',
          'Confirme',
          'La mission passe en "Terminée"',
        ],
        permissions: 'Tout le monde',
      },
      {
        id: '45', label: 'Prendre en charge une relivraison via scan QR',
        description: 'Tu prends la mission de relivraison directement depuis le véhicule.',
        procedure: [
          'Scanne le QR d\'un véhicule éligible à la relivraison',
          'Clique "🚛 Relivrer ce véhicule"',
          'Une fenêtre de confirmation s\'ouvre avec le véhicule et l\'adresse de livraison',
          'Confirme : la mission est créée et t\'est attribuée',
        ],
        permissions: 'Chauffeur (un dispatcher peut aussi le faire avec un sélecteur de chauffeur)',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'fourriere',
    title: 'Casquette Fourrière',
    emoji: '🚓',
    functions: [
      {
        id: '100', label: 'Voir la liste des véhicules en fourrière',
        description: 'Tous les véhicules en parc, regroupés par zone.',
        procedure: [
          'Clique sur "Fourrière" dans le menu de gauche',
          'Vérifie que les véhicules sont bien regroupés par zone',
          'Les compteurs en haut indiquent combien de véhicules par zone',
        ],
        permissions: 'Module fourrière / Admin',
      },
      {
        id: '101', label: 'Voir le plan visuel du parc',
        description: 'Représentation graphique du parc, avec glisser-déposer pour déplacer un véhicule.',
        procedure: [
          'Va sur "Fourrière" → "Plan du parc"',
          'Trouve un véhicule sur le plan',
          'Glisse-le d\'une case à une autre',
          'Recharge la page : la nouvelle position doit être conservée',
        ],
        permissions: 'Module fourrière / Admin',
      },
      {
        id: '110', label: 'Transférer un véhicule vers une autre zone',
        description: 'Tu utilises l\'écran QR : bouton Transférer.',
        procedure: [
          'Scanne le QR d\'une étiquette',
          'Clique "🚛 Transférer vers une zone"',
          'Choisis une zone de destination',
          'Une suggestion automatique d\'emplacement (rangée + place) doit apparaître',
          'Confirme : le véhicule est transféré',
        ],
        permissions: 'Module fourrière / Admin',
      },
      {
        id: '120', label: 'Restituer un véhicule avec calcul automatique des frais',
        description: 'Forfait + km + gardiennage : tout est calculé pour toi. Trois modes de paiement possibles.',
        procedure: [
          'Sur la fiche d\'une mission en parc (type Mal Garée ou Rodéo)',
          'Clique "🔑 Restituer le véhicule"',
          'Une fenêtre s\'ouvre avec le calcul détaillé',
          'Teste un des trois modes : Facture (envoi à la facturation), Cash chauffeur, ou Sans frais',
          'Confirme',
        ],
        permissions: 'Module fourrière / Admin',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'facturation',
    title: 'Casquette Facturation',
    emoji: '🧾',
    functions: [
      {
        id: '130', label: 'Voir la liste des missions à facturer',
        description: 'Toutes les missions clôturées qui attendent leur facturation.',
        procedure: [
          'Clique sur "Facturation" dans le menu de gauche',
          'Vérifie la liste des missions',
          'Sur les missions qui ont déjà été payées, un badge "X€ encaissé" est visible',
          'Le tri par date doit fonctionner',
        ],
        permissions: 'Module facturation / Admin',
      },
      {
        id: '132', label: 'Ouvrir la fenêtre de facturation',
        description: 'Fenêtre qui regroupe toutes les infos nécessaires pour préparer la facture.',
        procedure: [
          'Clique "Facturer →" sur une mission',
          'La fenêtre s\'ouvre',
          'Vérifie que tu vois bien : infos mission, infos client, lignes du devis, encaissements déjà reçus',
          'Modifie une quantité pour tester',
        ],
        permissions: 'Module facturation / Admin',
      },
      {
        id: '133', label: 'Préparer le devis',
        description: 'L\'app crée automatiquement le devis avec forfait + kilomètres + gardiennage.',
        procedure: [
          'Dans la fenêtre de facturation, choisis le client',
          'Vérifie les lignes automatiques (forfait, km, gardiennage)',
          'Clique "Créer le devis"',
          'Vérifie que le devis est bien créé (statut brouillon)',
        ],
        permissions: 'Module facturation / Admin',
        tip: 'Pour tester, choisis une mission test pour ne pas polluer un vrai client.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  {
    id: 'encaissement',
    title: 'Casquette Encaissement bureau',
    emoji: '💰',
    functions: [
      {
        id: '145', label: 'Encaisser un passage à la caisse',
        description: 'Quand un client vient payer directement au bureau, sans mission ouverte.',
        procedure: [
          'Va sur la page Encaissement (pas depuis une mission)',
          'Tape une plaque (commence par "TEST")',
          'Suis le parcours : véhicule → motif → adresse → paiement → client',
          'Valide',
        ],
        permissions: 'Module encaissement',
      },
      {
        id: '146', label: 'Détection automatique d\'une mission ouverte',
        description: 'Si tu tapes la plaque d\'un véhicule actuellement en parc, l\'app le détecte.',
        procedure: [
          'Sur la page Encaissement, tape la plaque d\'un véhicule actuellement en parc',
          'Un bandeau vert "Mission ouverte trouvée" doit apparaître',
          'Clique "💳 Encaisser cette mission →"',
          'Tu es redirigé vers un encaissement déjà rempli',
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

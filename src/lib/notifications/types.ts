// src/lib/notifications/types.ts
//
// Catalogue figé des types de notifications gérés par l'app.
// Chaque type est applicable a un sous-ensemble de roles → l'UI admin
// n'affiche que les checkbox pertinentes par user.
//
// Pour ajouter un type : ajouter une entree ici + brancher l'emission
// (cf src/lib/notifications/send.ts a venir dans N3).

export type NotificationCategory = 'dispatcher' | 'driver' | 'admin' | 'on_duty'

export interface NotificationType {
  key:         string
  label:       string
  description: string
  category:    NotificationCategory
  /** Roles pour lesquels ce type est pertinent (UI admin filtre dessus) */
  applicableRoles: Array<'driver' | 'dispatcher' | 'admin' | 'superadmin'>
  /** Default enabled si pas de ligne explicite en notification_preferences */
  defaultEnabled: boolean
}

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  {
    key:             'mobia_draft',
    label:           'Brouillon préparé par Mobia (dossier Claudy)',
    description:     'Un brouillon de réponse attend dans info@ pour un mail du dossier Claudy. Une seule notification par mail, jamais de rappel.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  // ── Dispatcher (et admin/superadmin) ────────────────────────────────
  {
    key:             'garage_cancel_request',
    label:           'Annulation demandée par un garage',
    description:     'Un garage demande l’annulation d’une mission déjà acceptée : à décider dans Annulations garages.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'new_mission_received',
    label:           'Nouvelle mission entrante',
    description:     'Mission VAB/email/manuelle reçue, en attente de dispatch.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'auto_dispatch_refused',
    label:           'Auto-dispatch refusé',
    description:     'Un chauffeur a répondu "Pas dispo" sur une proposition auto-dispatch.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'auto_dispatch_timeout',
    label:           'Auto-dispatch sans réponse',
    description:     'Timeout 90s atteint sans réponse → escalade dispatcher de garde.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'payment_validated',
    label:           'Paiement validé',
    description:     'Un paiement encaissé a été vérifié et validé.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  false,
  },
  {
    key:             'axa_new_to_validate',
    label:           'Mission AXA à valider',
    description:     'Mission AXA (go&assist) reçue en « nouveau » — fenêtre d\'acceptation courte, valider vite.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'axa_poll_down',
    label:           'go&assist déconnecté',
    description:     'Le poll AXA go&assist échoue depuis 3 tours : réamorcer le jeton dans Admin › AXA go&assist. Rappel toutes les 6 h.',
    category:        'admin',
    applicableRoles: ['superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'axa_poll_up',
    label:           'go&assist reconnecté',
    description:     'Le poll AXA go&assist fonctionne à nouveau après une panne.',
    category:        'admin',
    applicableRoles: ['superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'axa_cancelled_after_start',
    label:           'Mission AXA annulée (chauffeur parti)',
    description:     'Une mission AXA a été annulée alors que le chauffeur était en route → trajet à vide à facturer.',
    category:        'dispatcher',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'boutade_mirror',
    label:           'Boutade chauffeur (copie)',
    description:     'Copie de la vanne humoristique affichée au chauffeur à l\'acceptation d\'une mission.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },

  // ── Chauffeur ────────────────────────────────────────────────────────
  {
    key:             'fiche_ouverte_rappel',
    label:           'Fiche à clôturer',
    description:     'Une de tes fiches est ouverte depuis trop longtemps : clôture-la ou mets-la en parc.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'mail_agent_digest',
    label:           'Courrier à décider (matin)',
    description:     'Chaque matin à 8 h 30, le nombre de mails qui attendent une décision dans Agent Mail.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'fiche_ouverte_dispatch',
    label:           'Fiche chauffeur ouverte depuis trop longtemps',
    description:     'Un chauffeur n\'a pas clôturé une fiche malgré les rappels.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'mission_assigned_manual',
    label:           'Nouvelle mission assignée',
    description:     'Le dispatcher t\'a assigné manuellement une mission.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'auto_dispatch_dispo_request',
    label:           'Demande de dispo (auto-dispatch)',
    description:     'Question "Tu es dispo dans combien de temps ?" pour une mission entrante.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'check_vehicule_due',
    label:           'Check véhicule à effectuer',
    description:     'Rappel pour effectuer le check véhicule quotidien.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },

  // ── Admin ────────────────────────────────────────────────────────────
  {
    key:             'email_parse_error',
    label:           'Erreur parsing email',
    description:     'Un email entrant n\'a pas pu être parsé (mission ratée).',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'touring_cancelled',
    label:           'Touring — annulation détectée',
    description:     'Une mission Touring a disparu de COMEX (annulée/réattribuée) : traitée sans frais ou en déplacement.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin', 'dispatcher'],
    defaultEnabled:  true,
  },
  {
    key:             'saisie_facturation',
    label:           'Saisie — état de frais à traiter',
    description:     'Le cron a préparé des états de frais de saisie (à facturer, gardiennage, clôture Domaine).',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'expert_access',
    label:           'Accès expert (validation)',
    description:     'Un expert scanne le QR de l\'accueil pour la première fois (ou ajoute un bureau) : popup bloquant Valider / Refuser — le premier qui répond décide.',
    category:        'admin',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'expert_visit',
    label:           'Expert au parc',
    description:     'Un expert a vu un véhicule (contrôle de sortie activé) ou pose une question depuis son téléphone.',
    category:        'admin',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'levee_saisie_alarme',
    label:           'Levée de saisie à vérifier',
    description:     'Une levée de saisie reçue par mail ne peut pas être rattachée seule (plusieurs fiches possibles, deuxième levée, ordre anormal…). Le premier qui décide ferme l’alarme pour tous.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'cron_alert',
    label:           'Lecture automatique en panne',
    description:     'Une lecture automatique (réquisitoires, levées de saisie) échoue : à vérifier avant que des documents ne se perdent.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'verification_parc',
    label:           'Vérification physique au parc',
    description:     'Demande de vérifier sur place la présence de véhicules (popup bloquant jusqu\'à confirmation).',
    category:        'admin',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'garde_uncovered',
    label:           'Créneau de garde non couvert',
    description:     'Un créneau jour ou nuit n\'a aucun chauffeur assigné.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },

  // ── Dispatcher de garde (escalade) ───────────────────────────────────
  {
    key:             'escalation_call',
    label:           'Appel d\'escalade (auto-call Teams)',
    description:     'Auto-dispatch sans réponse → déclenche un appel Teams vers le dispatcher de garde.',
    category:        'on_duty',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'payment_derogation_requested',
    label:           'Demande de dérogation paiement',
    description:     'Un chauffeur demande une dérogation (annulation/ajustement) sur un montant à encaisser.',
    category:        'on_duty',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'restitution_derogation_requested',
    label:           'Dérogation de restitution à valider',
    description:     'Un collègue demande votre accord (avec votre code) pour débloquer une restitution au parc.',
    category:        'on_duty',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'courrier_task',
    label:           'Courrier : tâche ou message pour vous',
    description:     'Un courrier reçu demande une action de votre part (tâche, rappel, information).',
    category:        'on_duty',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'payment_derogation_decided',
    label:           'Réponse à dérogation paiement',
    description:     'Le dispatcher de garde a statué sur ta demande de dérogation.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'driver_amount_set',
    label:           'Montant à encaisser fixé/modifié par le chauffeur',
    description:     'Un chauffeur a ajouté ou modifié le montant à encaisser sur une mission (geste dossier). À vérifier.',
    category:        'on_duty',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'pin_setup_reminder',
    label:           'Rappel : définir ton code de validation',
    description:     'Invite l\'utilisateur à définir son code personnel à 4 chiffres (validation encaissement/caisse).',
    category:        'admin',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'pin_recall_check',
    label:           'Vérif mémoire : te souviens-tu de ton code ?',
    description:     'Demande à un utilisateur qui a déjà un code de confirmer qu\'il s\'en souvient (ou de le redéfinir).',
    category:        'admin',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'comex_login_failed',
    label:           'COMEX injoignable (login échoue)',
    description:     'Le login Touring/COMEX échoue de façon répétée → la synchro des statuts est interrompue.',
    category:        'admin',
    applicableRoles: ['superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'mission_cancelled_by_insurer',
    label:           'Mission annulée par l\'assistance',
    description:     'L\'assisteur (Allianz, etc.) a annulé l\'affectation par e-mail → la fiche est annulée (ou trajet à vide si déjà démarrée).',
    category:        'on_duty',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'kaze_cancelled_after_start',
    label:           'Mission Kaze annulée après acceptation',
    description:     'Kaze a annulé une mission déjà acceptée par le chauffeur → trajet à vide à facturer (chauffeur : fais demi-tour).',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },

  // ── Congés (RH) ──────────────────────────────────────────────────────
  {
    key:             'conge_requested',
    label:           'Demande de congé',
    description:     'Un travailleur a demandé un congé → à valider.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'conge_decided',
    label:           'Congé traité',
    description:     'Ta demande de congé a été approuvée ou refusée.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'garde_swap_requested',
    label:           'Demande de remplacement de garde',
    description:     'Un collègue te demande de le remplacer sur un jour de garde.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'garde_swap_decided',
    label:           'Réponse à ta demande de remplacement',
    description:     'Le collègue a accepté ou refusé de te remplacer.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'kaze_accept_manual',
    label:           'Kaze : acceptation à faire à la main',
    description:     "L'acceptation automatique d'une proposition Kaze a échoué : il faut l'accepter dans Kaze.",
    category:        'admin',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'kaze_proposal_missing',
    label:           'IMA / Kaze : proposition non transmise',
    description:     "Un mail IMA « A traiter » est arrivé mais Kaze n'a pas envoyé la proposition à VD Soft : il faut l'accepter directement dans Kaze.",
    category:        'admin',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'vab_onsite_failed',
    label:           'VAB : clôture sur place non passée',
    description:     "VD Soft n'a pas pu clôturer la mission chez VAB au moment du choix du chauffeur. Pour un remorquage, la demande de remorquage n'existe pas encore chez VAB : la faire dans Comet.",
    category:        'admin',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'vab_dossiers_ouverts',
    label:           'VAB : dossiers non clôturés',
    description:     "Des dossiers restent ouverts chez VAB alors que l'intervention est finie chez nous.",
    category:        'admin',
    applicableRoles: ['superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'siabis_couvert_request',
    label:           'Demande de passage en Siabis couvert',
    description:     'Un chauffeur demande de passer une fiche non couverte en couvert : popup obligatoire, le dispatch confirme ou refuse.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'siabis_couvert_decided',
    label:           'Réponse du dispatch (Siabis couvert)',
    description:     'Le dispatch a confirmé ou refusé le passage en Siabis couvert.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'question_equipe',
    label:           'Question de la direction',
    description:     'Une question à laquelle on répond d’un bouton (ex. Utile / Pas utile). Revient toutes les 10 min tant qu’on n’a pas répondu.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'question_reponse',
    label:           'Réponse à une question posée',
    description:     'Un membre de l’équipe a répondu à une question de la direction.',
    category:        'admin',
    applicableRoles: ['admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    key:             'feature_announcement',
    label:           'Nouveautés de l\'app',
    description:     'Annonce d\'une nouvelle fonctionnalité.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    // Idée de Franck (Olivier 30/09/2026) : la nuit, le 1er départ (et la réserve
    // si elle l'a activé) est prévenu d'une mission libre. Cf lib/missions/market-notify.ts.
    key:             'market_new_mission',
    label:           'Nouvelle mission dans Momo Market (garde de nuit)',
    description:     'Une mission attend dans Momo Market pendant ta garde de nuit.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'market_claimed',
    label:           'Mission prise dans Momo Market',
    description:     'Un chauffeur a pris une mission dans Momo Market.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    // Propositions de nuit (Olivier 30/09/2026) : « J'accepte » / « Je suis déjà en
    // mission » ; appel au 1er départ après 2 min. Cf lib/missions/market-proposals.ts.
    key:             'market_proposal',
    label:           'Mission proposée (garde de nuit)',
    description:     'Une mission libre t\'est proposée pendant ta garde de nuit : accepte-la ou dis que tu es déjà en mission.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'market_proposal_update',
    label:           'Proposition de nuit : suivi',
    description:     'Mission passée à la réserve, ou libre à dispatcher parce que personne ne l\'a prise.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    // Changement d'adresse de livraison reçu de l'assistance en cours de mission
    // (Olivier 05/10/2026, 2DTV183) : popup chauffeur (appeler le dispatch) et popup
    // dispatch (appliquer / garder). Cf lib/missions/address-change.ts.
    key:             'mission_address_changed',
    label:           'Adresse de livraison modifiée par l’assistance',
    description:     'Chauffeur : ne pas livrer, appeler le dispatch. Dispatch : appliquer la nouvelle adresse ou garder l’actuelle.',
    category:        'dispatcher',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
  {
    // Talkie « Garde de nuit » (Olivier 30/09/2026) : message reçu alors que le talkie
    // n'était pas ouvert. Cf /talkie et /api/talkie/messages.
    key:             'talkie_message',
    label:           'Talkie : message de la garde de nuit',
    description:     'L’autre chauffeur de garde t’a parlé sur le talkie alors qu’il n’était pas ouvert.',
    category:        'driver',
    applicableRoles: ['driver'],
    defaultEnabled:  true,
  },
  {
    key:             'reserve_notif_toggled',
    label:           'Réserve : notif de nuit désactivée / réactivée',
    description:     'Le chauffeur de réserve a coupé (ou remis) sa notif des missions libres pour la nuit.',
    category:        'dispatcher',
    applicableRoles: ['dispatcher', 'admin', 'superadmin'],
    defaultEnabled:  true,
  },
] as const

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  dispatcher: 'Dispatcher',
  driver:     'Chauffeur',
  admin:      'Admin',
  on_duty:    'Dispatcher de garde (escalade)',
}

/** Liste les types pertinents pour un role donne. */
export function getApplicableTypes(role: string): NotificationType[] {
  return NOTIFICATION_TYPES.filter(t =>
    (t.applicableRoles as readonly string[]).includes(role)
  )
}

/** Resout l'etat enabled effectif : pref explicite si presente, sinon default. */
export function isEnabled(
  type: string,
  prefs: Map<string, boolean>,
): boolean {
  const explicit = prefs.get(type)
  if (typeof explicit === 'boolean') return explicit
  const def = NOTIFICATION_TYPES.find(t => t.key === type)
  return def?.defaultEnabled ?? false
}

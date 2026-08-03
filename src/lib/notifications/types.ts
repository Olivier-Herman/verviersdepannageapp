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
  // ── Dispatcher (et admin/superadmin) ────────────────────────────────
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

  // ── Chauffeur ────────────────────────────────────────────────────────
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
    key:             'feature_announcement',
    label:           'Nouveautés de l\'app',
    description:     'Annonce d\'une nouvelle fonctionnalité.',
    category:        'driver',
    applicableRoles: ['driver', 'dispatcher', 'admin', 'superadmin'],
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

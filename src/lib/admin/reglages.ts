// src/lib/admin/reglages.ts
//
// Catalogue UNIQUE de la page Réglages (ex-Administration), option C validée par
// Olivier le 11/11/2026 (maquette https://claude.ai/artifact/GV8tdegb5gGZ5H1yE539wo) :
// « Au quotidien » en tête, 8 rubriques, 18 écrans, « Rangé » en bas.
//
// Un ÉCRAN regroupe les petites pages d'un même sujet en ONGLETS. Chaque onglet est
// une page existante, à son adresse habituelle : rien n'est réécrit, les anciens liens
// ouvrent directement le bon onglet, et les accès ne changent pas (consigne d'Olivier
// du 11/11 : « tout ce qui est accès doit rester avec même accès »). `superadminOnly`
// et `obd` reprennent exactement les conditions des anciennes tuiles.
//
// Nouvelle page sous /admin = une entrée ici (onglet d'un écran, ou Au quotidien /
// Rangé). Plus de tuile ni de menu du haut à tenir à jour en parallèle.

export interface ReglageLien {
  href:            string
  label:           string
  /** Une ligne lue par l'utilisateur (sans jargon). */
  desc?:           string
  /** Mots supplémentaires pour la recherche (synonymes). */
  mots?:           string
  superadminOnly?: boolean
  /** Visible seulement si la préversion « diagnostic OBD » est ouverte à l'utilisateur. */
  obd?:            boolean
}

export interface ReglageEcran {
  key:     string
  label:   string
  desc:    string
  onglets: ReglageLien[]
}

export interface ReglageRubrique {
  key:    string
  label:  string
  ecrans: ReglageEcran[]
}

/** Travail de tous les jours : gros boutons en tête de page. */
export const QUOTIDIEN: ReglageLien[] = [
  { href: '/admin/agents',        label: 'Agents',            desc: 'Propositions des agents à valider : paiements, factures d’achat, notes de crédit, pièces pour le comptable.', mots: 'propositions valider florent remi aurelie benoit' },
  { href: '/paiements',           label: 'Paiements',         desc: 'Factures fournisseur à payer et lot du jour de 14 h 30.', mots: 'paiements fournisseurs lot virement', superadminOnly: true },
  { href: '/admin/cash',          label: 'Caisses',           desc: 'Caisses des chauffeurs, mouvements et contrôle.', mots: 'caisse especes cash' },
  { href: '/admin/demandes-site', label: 'Demandes du site',  desc: '« Rappelez-moi » avec le temps restant avant le rappel promis, et candidatures chauffeur avec leur CV.', mots: 'rappelez-moi candidature cv site' },
]

/** Travail courant moins fréquent : liens sous les gros boutons. */
export const QUOTIDIEN_AUSSI: ReglageLien[] = [
  { href: '/admin/amendes',   label: 'Amendes',            desc: 'PV reçus, statistiques par chauffeur, attribution.', mots: 'pv amende' },
  { href: '/admin/ventes',    label: 'Ventes',             desc: 'Véhicules mis en vente sur le site : offres et attribution.', mots: 'vente vehicule lot offre' },
  { href: '/admin/tgr',       label: 'Service TGR',        desc: 'Demandes Touring Gros Recouvrement.', mots: 'tgr touring' },
  { href: '/admin/documents', label: 'Documents',          desc: 'Documents remis aux chauffeurs.', mots: 'document chauffeur' },
]

export const RUBRIQUES: ReglageRubrique[] = [
  {
    key: 'missions', label: 'Missions et dispatch',
    ecrans: [
      { key: 'sources', label: 'Sources de mission', desc: 'Touring, Ethias, Police, Privé… Client facturé par défaut, regroupements.',
        onglets: [{ href: '/admin/sources', label: 'Sources de mission', mots: 'assistance assisteur client defaut' }] },
      { key: 'lieux', label: 'Lieux', desc: 'Dépôts, dépanneuses, zones de police, lieux de remplacement, motifs de saisie.',
        onglets: [
          { href: '/admin/depots',        label: 'Dépôts',          mots: 'depot pepinster aywaille site' },
          { href: '/admin/trucks',        label: 'Dépanneuses',     mots: 'camion depanneuse plateau' },
          { href: '/admin/police-zones',  label: 'Zones de police', mots: 'police zone vesdre fagnes' },
          { href: '/admin/vr-locations',  label: 'Lieux VR',        mots: 'vehicule de remplacement location' },
          { href: '/admin/saisie-motifs', label: 'Motifs de saisie', mots: 'saisie motif police etiquette' },
        ] },
      { key: 'garde', label: 'Garde', desc: 'Heures de jour et de nuit, plage de la garde de nuit automatique.',
        onglets: [{ href: '/admin/garde-schedule', label: 'Plages de garde', mots: 'garde nuit jour horaire' }] },
      { key: 'documents-mission', label: 'Documents de mission', desc: 'Modèles de décharge et liste du check véhicule.',
        onglets: [
          { href: '/admin/decharges',      label: 'Décharges',      mots: 'decharge refus signature' },
          { href: '/admin/check-vehicule', label: 'Check véhicule', mots: 'check controle camion checklist' },
        ] },
    ],
  },
  {
    key: 'prix', label: 'Prix et facturation',
    ecrans: [
      { key: 'tarifs', label: 'Tarifs', desc: 'Grilles des assistances, transports, majorations horaires, évènements.',
        onglets: [
          { href: '/admin/tarifs',           label: 'Assistances', mots: 'tarif grille forfait km prix assurance' },
          { href: '/admin/tarifs-transport', label: 'Transport',   mots: 'transport rapatriement gabarit km' },
          { href: '/admin/surcharges',       label: 'Majorations', mots: 'surcharge majoration nuit weekend ferie horaire' },
          { href: '/admin/francofolies',     label: 'Évènements',  mots: 'francofolies spa evenement mal garee', superadminOnly: true },
        ] },
      { key: 'facturation-auto', label: 'Facturation automatique', desc: 'Quelles missions se facturent seules, et la part du robot.',
        onglets: [{ href: '/admin/facturation-auto', label: 'Facturation automatique', mots: 'robot facture automatique', superadminOnly: true }] },
    ],
  },
  {
    key: 'parc', label: 'Parc',
    ecrans: [
      { key: 'plan-parc', label: 'Plan du parc', desc: 'Zones, rangées et emplacements de la fourrière.',
        onglets: [{ href: '/admin/parc', label: 'Plan du parc', mots: 'fourriere zone rangee emplacement' }] },
      { key: 'etiquettes', label: 'Étiquettes', desc: 'Modèles d’étiquettes de l’imprimante et impression de test.',
        onglets: [
          { href: '/admin/labels',            label: 'Modèles',          mots: 'etiquette zebra imprimante' },
          { href: '/admin/labels/test-print', label: 'Impression de test', mots: 'test imprimante' },
        ] },
    ],
  },
  {
    key: 'accueil', label: 'Accueil',
    ecrans: [
      { key: 'accueil', label: 'Accueil', desc: 'Motifs de visite et d’appel, qui reçoit quoi, visites au comptoir, accès des experts.',
        onglets: [
          { href: '/admin/reception-motifs', label: 'Motifs',       mots: 'reception motif visite appel' },
          { href: '/admin/competences',      label: 'Compétences',  mots: 'competence matrice reception' },
          { href: '/admin/visites',          label: 'Visites',      mots: 'visite comptoir expertise bureau' },
          { href: '/admin/experts',          label: 'Experts',      mots: 'expert qr telephone' },
        ] },
    ],
  },
  {
    key: 'personnes', label: 'Personnes et accès',
    ecrans: [
      { key: 'utilisateurs', label: 'Utilisateurs', desc: 'Comptes, rôles, accès et mots de passe.',
        onglets: [{ href: '/admin/users', label: 'Utilisateurs', mots: 'utilisateur compte role acces mot de passe chauffeur dispatcher' }] },
      { key: 'garages-clients', label: 'Garages et clients', desc: 'Garages partenaires, leurs comptes, l’espace client EBAC / Centracar.',
        onglets: [
          { href: '/admin/garage-partners', label: 'Garages',         mots: 'garage partenaire' },
          { href: '/admin/garage-users',    label: 'Comptes garages', mots: 'compte garage bienvenue' },
          { href: '/admin/espace-client',   label: 'Espace client',   mots: 'ebac centracar espace client invitation' },
        ] },
    ],
  },
  {
    key: 'notifications', label: 'Notifications',
    ecrans: [
      { key: 'notifications', label: 'Notifications', desc: 'Qui reçoit quelle notification, et avec quel son.',
        onglets: [
          { href: '/admin/notifications',      label: 'Destinataires', mots: 'notification push destinataire' },
          { href: '/admin/sons-notifications', label: 'Sons',          mots: 'son sonnerie voix iphone' },
        ] },
    ],
  },
  {
    key: 'general', label: 'Général',
    ecrans: [
      { key: 'parametres', label: 'Paramètres', desc: 'Tous les réglages métier, les listes et les raccourcis d’appel.',
        onglets: [{ href: '/admin/settings', label: 'Paramètres', mots: 'parametre reglage metier' }] },
      { key: 'preversions', label: 'Préversions', desc: 'Nouveautés en test et déploiement de la clôture « Action ».',
        onglets: [
          { href: '/admin/preversions', label: 'Nouveautés en test', mots: 'preversion test pilote', superadminOnly: true },
          { href: '/admin/flux2',       label: 'Flux 2',             mots: 'flux 2 cloture action deploiement' },
        ] },
    ],
  },
  {
    key: 'surveillance', label: 'Surveillance',
    ecrans: [
      { key: 'connexions', label: 'État des connexions', desc: 'Liaisons avec AXA et VAB, vérifications à la demande, erreurs.',
        onglets: [
          { href: '/admin/axa',         label: 'AXA',           mots: 'axa go&assist connexion jeton' },
          { href: '/admin/vab-console', label: 'VAB',           mots: 'vab comet' },
          { href: '/admin/diagnostics', label: 'Vérifications', mots: 'diagnostic verification test mail comex graph', superadminOnly: true },
          { href: '/admin/logs',        label: 'Erreurs',       mots: 'erreur log bug', superadminOnly: true },
        ] },
      { key: 'conversations', label: 'Conversations', desc: 'Échanges avec Sam / Sonic, Max et l’assistant mécano.',
        onglets: [
          { href: '/admin/sam-echanges', label: 'Sam / Sonic', mots: 'sam sonic chauffeur conversation', superadminOnly: true },
          { href: '/admin/max-echanges', label: 'Max',         mots: 'max bureau conversation', superadminOnly: true },
          { href: '/admin/matthieu',     label: 'Matthieu',    mots: 'mecano matthieu conversation' },
        ] },
      { key: 'chiffres', label: 'Chiffres', desc: 'Garde de nuit et utilisation de l’app par appareil.',
        onglets: [
          { href: '/admin/garde-nuit', label: 'Garde de nuit', mots: 'garde nuit acceptation delai refus' },
          { href: '/admin/adoption',   label: 'Adoption',      mots: 'adoption iphone android application' },
        ] },
      { key: 'historique', label: 'Historique', desc: 'Journal des actions, archives, liste brute des missions, archive TowSoft.',
        onglets: [
          { href: '/admin/activity',        label: 'Journal',             mots: 'journal activite qui quoi quand', superadminOnly: true },
          { href: '/admin/archives',        label: 'Archives',            mots: 'archive' },
          { href: '/admin/missions',        label: 'Missions',            mots: 'missions brute' },
          { href: '/admin/towsoft-archive', label: 'Archive TowSoft',     mots: 'towsoft' },
          { href: '/admin/diagnostics-obd', label: 'Diagnostics OBD',     mots: 'obd boitier code panne', obd: true },
        ] },
    ],
  },
]

/** Pages à l'arrêt : repliées en bas, rien n'est supprimé. */
export const RANGE: ReglageLien[] = [
  { href: '/admin/dispatch',              label: 'Dispatch (ancienne page)', desc: 'Raccourcis vers des pages rangées ailleurs dans Réglages.' },
  { href: '/admin/garage-cancellations',  label: 'Annulations garage',       desc: 'Demandes d’annulation des garages après acceptation. Aucune reçue à ce jour.' },
  { href: '/admin/vetements',             label: 'Pulls et t-shirts',        desc: 'Commande d’octobre 2026, passée.' },
  { href: '/facturation/touring',         label: 'Liste Touring (ancienne)', desc: 'Ancienne liste des fiches Touring à facturer ; remplacée par le filtre Touring d’À facturer et « Touring à valider ».' },
  { href: '/services/tgr',                label: 'TGR Touring',              desc: 'Services TGR Touring (rangé le 11/11/2026, peu utilisé).' },
  { href: '/admin/tgr',                   label: 'TGR Gestion',              desc: 'Gestion des services TGR Touring.' },
  { href: '/fourriere/migration',         label: 'Migration TowSoft',        desc: 'Reprise de l’ancien logiciel fourrière, terminée en juin 2026.' },
  { href: '/admin/boutades',              label: 'Boutades',                 desc: 'Historique des vannes affichées à Franck.', superadminOnly: true },
]

export interface Visibilite { superadmin: boolean; obd: boolean }
export const lienVisible = (l: ReglageLien, v: Visibilite) => (!l.superadminOnly || v.superadmin) && (!l.obd || v.obd)

/** Écran visible avec ses seuls onglets visibles (null si aucun). */
export function ecranVisible(e: ReglageEcran, v: Visibilite): ReglageEcran | null {
  const onglets = e.onglets.filter(o => lienVisible(o, v))
  return onglets.length ? { ...e, onglets } : null
}

const correspond = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/')

/**
 * Écran affiché en tête d'une page /admin/… : titre + onglets. Les pages « Au quotidien »
 * et « Rangé » sont des écrans d'un seul onglet. Le href le plus long gagne
 * (/admin/labels/test-print avant /admin/labels).
 */
export interface EcranTrouve {
  ecran:    ReglageEcran
  /** href de l'onglet actif. */
  actif:    string
  /** Clé de rubrique, href du bouton « Au quotidien », ou 'range' : sert à l'habillage. */
  visuel:   string
  /** Nom de la rubrique (« Au quotidien », « Rangé » pour les autres). */
  rubrique: string
}

export function ecranDe(pathname: string, v: Visibilite): EcranTrouve | null {
  let best: EcranTrouve | null = null
  const essayer = (e: ReglageEcran, l: ReglageLien, visuel: string, rubrique: string) => {
    if (correspond(pathname, l.href) && (!best || l.href.length > best.actif.length)) best = { ecran: e, actif: l.href, visuel, rubrique }
  }
  for (const r of RUBRIQUES) for (const e of r.ecrans) {
    const vis = ecranVisible(e, v)
    if (vis) for (const o of vis.onglets) essayer(vis, o, r.key, r.label)
  }
  for (const l of [...QUOTIDIEN, ...QUOTIDIEN_AUSSI]) essayer({ key: l.href, label: l.label, desc: l.desc || '', onglets: [l] }, l, l.href, 'Au quotidien')
  for (const l of RANGE) essayer({ key: l.href, label: l.label, desc: l.desc || '', onglets: [l] }, l, 'range', 'Rangé')
  return best
}

/** Nom affiché des groupes du registre métier (le groupe technique « Menu » regroupe des réglages divers). */
export const GROUPE_AFFICHE: Record<string, string> = { Menu: 'Divers', Odoo: 'Identifiants ERP' }

/** Ordre d'affichage des groupes du registre métier dans Paramètres. */
export const ORDRE_GROUPES = ['Odoo', 'Boîtes mail', 'Montants', 'Facturation', 'Dispatch', 'Fourrière', 'Site public', 'Menu'] as const

/** Minuscules sans accents, pour une recherche tolérante. */
export const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

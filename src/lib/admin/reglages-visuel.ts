// Habillage de la page Réglages et de ses écrans (Olivier 11/11/2026, maquette validée :
// https://claude.ai/artifact/691RdVeV3wwexScKXUZaSo). Une couleur et une icône par rubrique
// et par bouton « Au quotidien » ; partagé par l'accueil (ReglagesClient) et l'en-tête
// des écrans intérieurs (AdminNav). Fichier client-safe (aucun import serveur).

import {
  AlertTriangle, Bot, Banknote, Wallet, PhoneCall, Car, Shield, FileText,
  Radio, Receipt, Map as MapIcon, ConciergeBell, Users, Bell, SlidersHorizontal, Activity, Archive,
  type LucideIcon,
} from 'lucide-react'

export type Couleur = 'brand' | 'success' | 'info' | 'warning' | 'purple' | 'alert'

/** Dégradés francs (« pas un écran vert ») : cartes, bandeaux, icônes, onglet actif. */
export const DEGRADE: Record<Couleur, string> = {
  brand:   'from-rose-500 to-red-600 shadow-red-500/30',
  success: 'from-emerald-500 to-teal-600 shadow-emerald-500/30',
  info:    'from-sky-500 to-blue-600 shadow-blue-500/30',
  warning: 'from-amber-400 to-orange-500 shadow-orange-500/30',
  purple:  'from-violet-500 to-purple-600 shadow-purple-500/30',
  alert:   'from-orange-500 to-rose-500 shadow-rose-500/30',
}
/** Voile très léger en haut des cartes de rubrique. */
export const VOILE: Record<Couleur, string> = {
  brand: 'from-rose-500/10', success: 'from-emerald-500/10', info: 'from-sky-500/10', warning: 'from-amber-400/15', purple: 'from-violet-500/10', alert: 'from-orange-500/10',
}

export interface Visuel { icon: LucideIcon; couleur: Couleur }

/** Par href (Au quotidien) ou par clé de rubrique. */
export const VISUEL: Record<string, Visuel> = {
  '/admin/agents':        { icon: Bot,       couleur: 'purple' },
  '/paiements':           { icon: Banknote,  couleur: 'success' },
  '/admin/cash':          { icon: Wallet,    couleur: 'warning' },
  '/admin/demandes-site': { icon: PhoneCall, couleur: 'info' },
  '/admin/amendes':       { icon: AlertTriangle, couleur: 'alert' },
  '/admin/ventes':        { icon: Car,       couleur: 'info' },
  '/admin/tgr':           { icon: Shield,    couleur: 'purple' },
  '/admin/documents':     { icon: FileText,  couleur: 'success' },
  missions:      { icon: Radio,             couleur: 'info' },
  prix:          { icon: Receipt,           couleur: 'success' },
  parc:          { icon: MapIcon,           couleur: 'warning' },
  accueil:       { icon: ConciergeBell,     couleur: 'purple' },
  personnes:     { icon: Users,             couleur: 'brand' },
  notifications: { icon: Bell,              couleur: 'alert' },
  general:       { icon: SlidersHorizontal, couleur: 'info' },
  surveillance:  { icon: Activity,          couleur: 'success' },
  range:         { icon: Archive,           couleur: 'warning' },
}
export const VISUEL_DEFAUT: Visuel = { icon: SlidersHorizontal, couleur: 'info' }

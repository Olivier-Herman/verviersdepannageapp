// src/lib/chantiers.ts
//
// Module « Chantiers » — ce que partagent l'API, la page et le menu.
// Quatre statuts, dans l'ordre des colonnes. Olivier 09/09/2026.

export const CHANTIER_STATUSES = ['cours', 'attente', 'fini', 'dormant'] as const
export type ChantierStatus = typeof CHANTIER_STATUSES[number]

export const CHANTIER_COLUMNS: { key: ChantierStatus; label: string; hint: string }[] = [
  { key: 'cours',   label: 'En cours',   hint: 'on y travaille maintenant' },
  { key: 'attente', label: 'En attente', hint: 'bloqué : décision, migration, information' },
  { key: 'fini',    label: 'Terminé',    hint: 'livré et déployé' },
  { key: 'dormant', label: 'En sommeil', hint: 'ouvert, pas repris — à arbitrer' },
]

export const chantierStatusLabel = (s: string) => CHANTIER_COLUMNS.find(c => c.key === s)?.label || s

export interface Chantier {
  id:         string
  key:        string | null
  title:      string
  tag:        string | null
  status:     ChantierStatus
  note:       string | null
  position:   number
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface ChantierLog {
  id:          string
  chantier_id: string | null
  at:          string
  actor:       string | null
  text:        string
}

/** Superadmin par le rôle principal OU par la liste des rôles (même règle que /api/admin/boutades). */
export function isSuperadminSession(session: any): boolean {
  const role = session?.user?.role || ''
  const roles: string[] = Array.isArray(session?.user?.roles) ? session.user.roles : []
  return role === 'superadmin' || roles.includes('superadmin')
}

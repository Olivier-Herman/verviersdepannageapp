// Accès au module Paiements fournisseurs (Olivier 16/10/2026) :
// - le tri (ajouter / retirer de la liste d'attente) : superadmin ;
// - le lot du jour (choisir ce qui part) : superadmin + les comptes du réglage paiements_lot_user_ids (Momo).
import { getBusinessList } from '@/lib/settings/business'

export async function accesPaiements(session: any): Promise<{ id: string | null; tri: boolean; lot: boolean }> {
  const u = session?.user
  if (!u?.id) return { id: null, tri: false, lot: false }
  const roles = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  const superadmin = roles.includes('superadmin')
  const momo = (await getBusinessList('paiements_lot_user_ids').catch(() => [] as string[])).includes(u.id)
  return { id: u.id, tri: superadmin, lot: superadmin || momo }
}

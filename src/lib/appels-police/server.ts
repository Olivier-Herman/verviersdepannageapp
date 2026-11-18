// src/lib/appels-police/server.ts — appel police lancé par le dispatch (Olivier 18/11/2026).
// Le dispatch donne l'adresse et le chauffeur ; le chauffeur accepte, voit l'adresse, puis remplit son formulaire de
// création habituel avec l'adresse déjà encodée (le motif est toujours choisi par lui, sur place). Aucun rappel ni appel
// automatique. La création d'un appel police par le chauffeur seul reste en place.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export type Moi = { id: string; name: string | null; role: string | null; roles: string[]; dispatch: boolean }

export async function moi(): Promise<Moi | null> {
  const session = await getServerSession(authOptions)
  const email = (session?.user as any)?.email
  if (!email) return null
  const { data: u } = await createAdminClient().from('users').select('id, name, role, roles').eq('email', email).maybeSingle()
  if (!u) return null
  const roles: string[] = Array.isArray((u as any).roles) ? (u as any).roles : []
  const dispatch = ['dispatcher', 'admin', 'superadmin'].some(r => (u as any).role === r || roles.includes(r))
  return { id: (u as any).id, name: (u as any).name, role: (u as any).role, roles, dispatch }
}

export const STATUTS_ACTIFS = ['envoye', 'accepte']

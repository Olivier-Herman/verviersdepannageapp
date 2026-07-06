// src/app/api/requisitoires/[id]/delete/route.ts
//
// POST /api/requisitoires/[id]/delete
//   « Supprime » (masque) un item ignoré : passe en status='deleted' → n'apparaît
//   plus dans aucun onglet (ni « Ignorés », ni « Tous »). Suppression DOUCE : on
//   garde la ligne pour préserver la dédup par source_email_id (sinon le mail
//   serait re-scanné et reviendrait). Olivier 2026-07-06.
//   Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = user?.modules || []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { error } = await sb.from('requisitoire_intake')
    .update({ status: 'deleted' }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

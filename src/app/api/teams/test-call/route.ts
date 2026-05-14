// src/app/api/teams/test-call/route.ts
//
// POST /api/teams/test-call { to?: string }
//
// Outil de test pour valider la chaine Teams Phone PSTN.
// Si `to` n'est pas fourni, appelle le numero du user connecte (users.phone).
//
// Reserve admin/superadmin pour eviter les abus de coûts.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { initiatePstnCall }  from '@/lib/teams/call'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userId = (session.user as any).id

  let body: any = {}
  try { body = await req.json() } catch { /* body vide OK */ }

  let toPhone = (body.to || '').trim()
  let toDisplayName: string | undefined = body.toName

  // Si pas fourni, on lookup le phone du user connecte
  if (!toPhone) {
    const sb = createAdminClient()
    const { data: user } = await sb
      .from('users')
      .select('phone, name')
      .eq('id', userId)
      .maybeSingle()
    if (!user?.phone) {
      return NextResponse.json({
        error: 'Pas de phone fourni dans le body ET pas de phone configure sur ton user',
      }, { status: 400 })
    }
    toPhone = user.phone
    toDisplayName = user.name || 'Toi'
  }

  const result = await initiatePstnCall({ toPhone, toDisplayName })

  return NextResponse.json(result)
}

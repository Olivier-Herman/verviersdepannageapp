// src/app/api/fourriere/controle/route.ts
//
// Contrôle du parc (Olivier 21/10/2026).
//   GET  → contrôle en cours + derniers contrôles
//   POST → lance un contrôle (ou renvoie celui en cours)
// Accès : admin / superadmin / module fourrière.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { startControle }     from '@/lib/parc/controle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('parc_controles').select('id, status, started_at, closed_at, applied_at').order('started_at', { ascending: false }).limit(10)
  return NextResponse.json({ controles: data || [], current: (data || []).find(c => c.status === 'en_cours') || null })
}

export async function POST() {
  const session = await getServerSession(authOptions)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok || !a.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  try {
    const r = await startControle(sb, { id: a.id, name: (session?.user as any)?.name || 'fourrière' })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Lancement impossible' }, { status: 500 })
  }
}

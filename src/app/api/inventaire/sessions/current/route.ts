// src/app/api/inventaire/sessions/current/route.ts
//
// GET /api/inventaire/sessions/current
// Retourne la session active (la plus recente non completee) du user,
// avec ses items dans l ordre chronologique inverse (plus recent d abord).
//
// Permet a un user qui scanne depuis son iPhone de retrouver la meme session
// en ouvrant /fourriere/inventaire depuis son Mac.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: activeSession } = await sb
    .from('inventaire_sessions')
    .select('*')
    .eq('user_id', user.id)
    .is('completed_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeSession) {
    return NextResponse.json({ ok: true, session: null, items: [] })
  }

  const { data: items } = await sb
    .from('inventaire_session_items')
    .select('*')
    .eq('session_id', activeSession.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ ok: true, session: activeSession, items: items || [] })
}

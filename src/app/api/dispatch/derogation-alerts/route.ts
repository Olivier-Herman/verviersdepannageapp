// src/app/api/dispatch/derogation-alerts/route.ts
//
// GET : compte les derogations paiement pending + retourne le mission_id de
// la plus ancienne pour navigation rapide. Utilise par le badge global dans
// la sticky bar AppShell pour les roles dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ count: 0, first_mission_id: null })
  }

  const sb = createAdminClient()
  const { data } = await sb
    .from('payment_derogations')
    .select('mission_id, requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  return NextResponse.json({
    count:            data?.length || 0,
    first_mission_id: data?.[0]?.mission_id || null,
  })
}

// src/app/api/touring/reprocess-stuck/route.ts
//
// Diagnostic/action superadmin : reprocesse DIRECTEMENT les placeholders
// « PROCESSING_ » bloqués (traitement mail planté en cours). Contourne les filtres
// received_at de reprocess-errors (qui ratent les placeholders au received_at vide).
// Pour chaque : supprime le placeholder + re-télécharge le mail (source_email_id)
// et relance le traitement complet (en observe → parsing mail). Olivier 2026-07-07.
//
// GET /api/touring/reprocess-stuck

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : ((session.user as any).role ? [(session.user as any).role] : [])
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, source_email_id, created_at')
    .like('external_id', 'PROCESSING_%')
    .order('created_at', { ascending: false })
    .limit(10)

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0, message: 'Aucun placeholder PROCESSING_ bloqué.' })
  }

  const { processEmailMessage } = await import('@/lib/missions/processor')
  const results: any[] = []
  for (const m of rows as any[]) {
    if (!m.source_email_id) { results.push({ n: m.mission_number, skipped: 'pas de source_email_id (mail non ré-téléchargeable)' }); continue }
    try {
      await sb.from('incoming_missions').delete().eq('id', m.id)
      const res: any = await processEmailMessage(m.source_email_id)
      results.push({ n: m.mission_number, status: res?.status, mission: res?.missionId || null, source: res?.source || null, info: res?.error || res?.reason || null })
    } catch (e: any) {
      results.push({ n: m.mission_number, error: e?.message?.slice(0, 160) })
    }
  }

  return NextResponse.json({ ok: true, mode: process.env.TOURING_COMEX_MODE || 'observe', count: rows.length, results })
}

// src/app/api/ma-journee/route.ts
//
// GET /api/ma-journee — ce que « Ma journée » ne trouve pas déjà dans les API
// existantes (Parc, À facturer, Touring) : les réquisitoires reçus à rattacher et
// les mails de l'agent à décider. Préversion `ma_journee` (Olivier seul,
// 11/11/2026). Mêmes droits que les écrans d'origine : réquisitoires = module
// fourrière ou admin ; mails = admin, superadmin ou rôle mail_agent.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { isPreviewOn }       from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const me = sessionAccess(session, { roles: ['admin', 'superadmin'] })
  if (!me.id) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  const u = session!.user as any
  if (!(await isPreviewOn('ma_journee', u.role, u.id))) return NextResponse.json({ error: 'Préversion non activée' }, { status: 403 })

  const sb = createAdminClient()
  const canFourriere = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] }).ok
  const canMails     = sessionAccess(session, { roles: ['admin', 'superadmin', 'mail_agent'] }).ok

  const out: Record<string, unknown> = { canFourriere, canMails }

  if (canFourriere) {
    const { data, error } = await sb.from('requisitoire_intake')
      .select('id, subject, received_at, extracted, candidates, confidence, status, matched_mission_id, doc_type')
      .in('status', ['pending', 'to_verify']).order('received_at', { ascending: false }).limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const { count: robotToday } = await sb.from('requisitoire_intake').select('id', { count: 'exact', head: true })
      .eq('status', 'attached').is('attached_by', null).gte('attached_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    out.requisitoires = (data || []).map((r: any) => ({
      id: r.id, subject: r.subject, received_at: r.received_at, status: r.status, confidence: r.confidence,
      matched_mission_id: r.matched_mission_id, doc_type: r.doc_type,
      pv: r.extracted?.pv_number || null, plaque: r.extracted?.plaque || null,
      vehicule: [r.extracted?.marque, r.extracted?.modele].filter(Boolean).join(' ') || null,
      candidates: Array.isArray(r.candidates) ? r.candidates.length : 0,
    }))
    out.requisitoiresRobot24h = robotToday || 0
  }

  if (canMails) {
    const { data, error } = await sb.from('mail_agent_items')
      .select('id, handler, subject, from_email, received_at, status, blocked_reason')
      .in('status', ['to_decide', 'ready']).order('received_at', { ascending: false }).limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    out.mails = data || []
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}

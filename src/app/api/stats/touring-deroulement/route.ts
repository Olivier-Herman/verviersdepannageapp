// src/app/api/stats/touring-deroulement/route.ts
//
// Données du module « Déroulement Touring » (SLA historique, source COMEX BKO).
//   - monthly : moyennes mensuelles des 4 délais par phase (avant/après auto).
//   - rows    : détail des missions sur la période demandée (from/to), plafonné.
// Olivier 2026-08-06.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('role, roles').eq('email', session.user.email).maybeSingle()
  const roles = [(me as any)?.role, ...((me as any)?.roles || [])].filter(Boolean) as string[]
  if (!roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from')   // ISO
  const to   = url.searchParams.get('to')     // ISO
  const account = url.searchParams.get('account') || ''

  // Moyennes mensuelles (toute l'histoire) — la comparaison avant/après.
  const { data: monthly } = await sb.from('touring_deroulement_monthly').select('*').order('month')

  // Détail sur la période.
  let q = sb.from('touring_deroulement')
    .select('dossier, seq, account, file_date, action, order_num, plate, arc_code, prestataire, brand, model, statut_fact, auto_phase, assign_at, accept_at, onroad_at, onspot_at, end_at, delai_assign_accept, delai_accept_onroad, delai_assign_onspot, delai_accept_end')
    .order('file_date', { ascending: false })
    .limit(1000)
  if (from) q = q.gte('file_date', from)
  if (to)   q = q.lte('file_date', to)
  if (account) q = q.eq('account', account)
  const { data: rows } = await q

  const { count: total } = await sb.from('touring_deroulement').select('*', { count: 'exact', head: true })

  return NextResponse.json({ monthly: monthly || [], rows: rows || [], total: total || 0 })
}

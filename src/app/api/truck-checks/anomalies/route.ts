// GET  /api/truck-checks/anomalies → anomalies à traiter par camion + corrigées récemment (bureau)
// POST /api/truck-checks/anomalies { ids, note } → corrigé ; prévient le(s) chauffeur(s)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isReportViewer } from '@/lib/truck-checks/server'
import { openAnomalies, recentFixed, resolveAnomalies } from '@/lib/truck-checks/anomalies'

export const dynamic = 'force-dynamic'

async function viewer() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const u: any = session.user
  const sb = createAdminClient()
  return (await isReportViewer(sb, { id: u.id, role: u.role, roles: u.roles })) ? { sb, u } : null
}

export async function GET() {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const [open, fixed] = await Promise.all([openAnomalies(v.sb), recentFixed(v.sb)])
  return NextResponse.json({ ...open, fixed })
}

export async function POST(req: Request) {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 50) : []
  if (!ids.length) return NextResponse.json({ error: 'Aucune anomalie choisie.' }, { status: 400 })
  try {
    const r = await resolveAnomalies(v.sb, ids, String(b.note || ''), v.u.id)
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Enregistrement impossible.' }, { status: 500 }) }
}

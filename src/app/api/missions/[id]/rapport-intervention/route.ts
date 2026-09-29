// GET /api/missions/[id]/rapport-intervention — aperçu du rapport d'intervention
// (sources au tag rapport_facture : EBAC, Centracar). Pour vérifier, avant la
// facture, que tout y est. Une REM avec sa REL : le rapport couvre les deux.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { buildRapportData, renderRapportPdf } from '@/lib/missions/rapport-intervention'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (u.role === 'driver' && !(u.roles || []).some((r: string) => r !== 'driver')) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, parent_mission_id, mission_type').eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  const ids = [m.id]
  if (/relivraison/i.test(String(m.mission_type || '')) && m.parent_mission_id) ids.push(m.parent_mission_id)
  else {
    const { data: rel } = await sb.from('incoming_missions').select('id').eq('parent_mission_id', m.id).ilike('mission_type', 'relivraison').not('status', 'eq', 'cancelled').limit(1)
    if (rel?.[0]) ids.push(rel[0].id)
  }
  const d = await buildRapportData(ids, null)
  if (!d) return NextResponse.json({ error: 'Données absentes' }, { status: 404 })
  const pdf = await renderRapportPdf(d)
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Rapport-intervention-${d.number.replace(/\s+/g, '')}.pdf"`, 'Cache-Control': 'no-store' } })
}

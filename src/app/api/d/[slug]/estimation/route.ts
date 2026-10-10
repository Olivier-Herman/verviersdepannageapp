// POST /api/d/[slug]/estimation — { lat, lng } → estimations TVAC (dépannage sur place, remorquage jusqu'à son garage) pour un client sans assistance.
import { NextResponse } from 'next/server'
import { getClientSession, estimations } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const s = await getClientSession(params.slug)
  if (!s || !s.societe.clients_actif) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (s.client.assistance) return NextResponse.json({ assistance: true, dsp: null, rem: null })
  const b = await req.json().catch(() => ({}))
  const e = await estimations(s.societe, s.client, Number(b?.lat), Number(b?.lng)).catch(() => ({ dsp: null, rem: null, garage: null }))
  return NextResponse.json({ assistance: false, ...e })
}

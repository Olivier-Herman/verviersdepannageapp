// POST /api/d/[slug]/estimation — { lat, lng } → estimation TVAC d'un dépannage sur place pour un client sans assistance.
import { NextResponse } from 'next/server'
import { getClientSession, estimationDepannage } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const s = await getClientSession(params.slug)
  if (!s || !s.societe.clients_actif) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  if (s.client.assistance) return NextResponse.json({ assistance: true, tvac: null })
  const b = await req.json().catch(() => ({}))
  const tvac = await estimationDepannage(s.societe, Number(b?.lat), Number(b?.lng)).catch(() => null)
  return NextResponse.json({ assistance: false, tvac })
}

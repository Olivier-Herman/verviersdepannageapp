// POST /api/d/[slug]/commande/[id]/annulation — annulation par le client (voir annulerCommande).
import { NextResponse } from 'next/server'
import { getClientSession, annulerCommande } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { slug: string; id: string } }) {
  const s = await getClientSession(params.slug)
  if (!s) return NextResponse.json({ error: 'Session expirée : reconnectez-vous.' }, { status: 401 })
  const r = await annulerCommande(s.client, s.societe, params.id)
  return NextResponse.json(r.ok ? r : { error: r.message }, { status: r.ok ? 200 : 400 })
}

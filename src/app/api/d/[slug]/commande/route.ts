// POST /api/d/[slug]/commande — { adresse, lat, lng, panne, symptome } → demande de dépannage du client.
import { NextResponse } from 'next/server'
import { getClientSession, lireCommande, creerCommande, commandeDuClient } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const s = await getClientSession(params.slug)
  if (!s) return NextResponse.json({ error: 'Session expirée : reconnectez-vous.' }, { status: 401 })
  if (!s.societe.clients_actif) return NextResponse.json({ error: 'Ce service n’est pas activé par votre garage.' }, { status: 403 })
  const enCours = await commandeDuClient(s.client)
  if (enCours && !['terminee', 'annulee'].includes(enCours.suivi.statut)) return NextResponse.json({ error: 'Une demande est déjà en cours.' }, { status: 409 })
  const d = lireCommande(await req.json().catch(() => ({})))
  if (typeof d === 'string') return NextResponse.json({ error: d }, { status: 400 })
  try {
    const m = await creerCommande(s.client, s.societe, d)
    return NextResponse.json({ ok: true, id: m.id })
  } catch (e: any) {
    console.error('[clients garage] commande KO', e?.message)
    return NextResponse.json({ error: 'La demande n’a pas pu être envoyée. Appelez-nous.' }, { status: 500 })
  }
}

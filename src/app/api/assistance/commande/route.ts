// POST /api/assistance/commande — { vehiculeId, adresse, lat, lng, panne, symptome } → demande de dépannage.
import { NextResponse } from 'next/server'
import { getClientSession, lireCommande, creerCommande, commandeDuClient, vehiculeDuClient } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const s = await getClientSession()
  if (!s) return NextResponse.json({ error: 'Session expirée : reconnectez-vous.' }, { status: 401 })
  const enCours = await commandeDuClient(s.client)
  if (enCours && !['terminee', 'annulee'].includes(enCours.suivi.statut)) return NextResponse.json({ error: 'Une demande est déjà en cours.' }, { status: 409 })
  const d = lireCommande(await req.json().catch(() => ({})))
  if (typeof d === 'string') return NextResponse.json({ error: d }, { status: 400 })
  const v = await vehiculeDuClient(s.client.id, d.vehiculeId)
  if (!v) return NextResponse.json({ error: 'Véhicule inconnu.' }, { status: 404 })
  if (!v.societe.clients_actif) return NextResponse.json({ error: `${v.societe.nom} a suspendu ce service : appelez-nous.` }, { status: 403 })
  try {
    const m = await creerCommande(s.client, v, d)
    return NextResponse.json({ ok: true, id: m.id })
  } catch (e: any) {
    console.error('[VD Assistance] commande KO', e?.message)
    return NextResponse.json({ error: 'La demande n’a pas pu être envoyée. Appelez-nous.' }, { status: 500 })
  }
}

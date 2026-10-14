// GET /api/assistant/contexte?id=<mission> — ce que la pastille Max affiche de la fiche
// ouverte (Olivier 14/10/2026) : numéro, plaque, statut. Réservé aux personnes qui ont Max.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { assistantUser }     from '@/lib/assistant/access'

export const dynamic = 'force-dynamic'

const STATUT: Record<string, string> = { to_invoice: 'à facturer', completed: 'terminée', parked: 'au parc', gardiennage: 'au parc', cancelled: 'annulée', invoiced: 'facturée', assigned: 'assignée', in_progress: 'en cours', delivering: 'en livraison', new: 'nouvelle', dispatching: 'à dispatcher' }

export async function GET(req: Request) {
  const user = await assistantUser('bureau')
  if (!user) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ fiche: null })
  const { data: m } = await createAdminClient().from('incoming_missions').select('id, mission_number, vehicle_plate, status, billed_to_name, source').eq('id', id).maybeSingle()
  if (!m) return NextResponse.json({ fiche: null })
  return NextResponse.json({ fiche: { id: m.id, numero: m.mission_number, plaque: m.vehicle_plate, statut: STATUT[m.status] || m.status, client_facture: m.billed_to_name, source: m.source } })
}

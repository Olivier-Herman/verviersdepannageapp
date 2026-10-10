// POST /api/assistance/estimation — { vehiculeId, lat, lng } → estimations TVAC (sur place, remorquage jusqu'au
// garage du véhicule), seulement si le véhicule n'est pas couvert par l'assistance de son garage.
import { NextResponse } from 'next/server'
import { getClientSession, vehiculeDuClient, estimations } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const s = await getClientSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const v = await vehiculeDuClient(s.client.id, String(b?.vehiculeId || ''))
  if (!v) return NextResponse.json({ error: 'Véhicule inconnu' }, { status: 404 })
  if (v.assistance) return NextResponse.json({ assistance: true, dsp: null, rem: null, garage: v.garage.nom })
  const e = await estimations(v, Number(b?.lat), Number(b?.lng)).catch(() => ({ dsp: null, rem: null, garage: v.garage.nom }))
  return NextResponse.json({ assistance: false, ...e })
}

// POST /api/assistance/live-activity — { missionId, token } : jeton APNs de la Live Activity démarrée par l'app iPhone
// VD Assistance à l'envoi de la demande (Dynamic Island / écran verrouillé, Olivier 10/10/2026).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getClientSession } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const s = await getClientSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const token = String(b?.token || '')
  if (!/^[0-9a-f]{32,400}$/i.test(token)) return NextResponse.json({ error: 'Jeton invalide' }, { status: 400 })
  const { data, error } = await createAdminClient().from('incoming_missions').update({ client_la_token: token })
    .eq('id', String(b?.missionId || '')).eq('espace_client_id', s.client.id).select('id, status, on_way_at, on_site_at').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Demande inconnue' }, { status: 404 })
  // Le jeton arrive après coup : on aligne tout de suite l'activité sur l'étape réelle.
  const { majActiviteClient } = await import('@/lib/espace/client-notif')
  if (data.on_site_at) await majActiviteClient(data.id, 'sur_place')
  else if (data.on_way_at) await majActiviteClient(data.id, 'en_route')
  else if (data.status !== 'new') await majActiviteClient(data.id, 'acceptee')
  return NextResponse.json({ ok: true })
}

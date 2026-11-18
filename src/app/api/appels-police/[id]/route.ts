// /api/appels-police/[id] — lecture (chauffeur désigné ou dispatch) ; POST { action: accepter | lier | annuler }.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { moi } from '@/lib/appels-police/server'
import { sendNotification } from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

async function charger(id: string) {
  const { data } = await createAdminClient().from('appels_police').select('*').eq('id', id).maybeSingle()
  return data as any
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const u = await moi()
  if (!u) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const a = await charger(params.id)
  if (!a || (a.driver_id !== u.id && !u.dispatch)) return NextResponse.json({ error: 'Appel introuvable' }, { status: 404 })
  return NextResponse.json({ appel: a })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const u = await moi()
  if (!u) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const a = await charger(params.id)
  if (!a) return NextResponse.json({ error: 'Appel introuvable' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient(), now = new Date().toISOString()
  if (b?.action === 'annuler') {
    if (!u.dispatch) return NextResponse.json({ error: 'Réservé au dispatch' }, { status: 403 })
    if (a.status === 'complete') return NextResponse.json({ error: 'La fiche est déjà créée : annulez la fiche elle-même.' }, { status: 409 })
    await sb.from('appels_police').update({ status: 'annule', cancelled_at: now }).eq('id', a.id)
    // Le chauffeur est prévenu (Olivier 18/11/2026 : « la police a annulé l'appel »).
    await sendNotification(a.driver_id, 'appel_police_annule', {
      title: '🚓 Appel police annulé',
      body: `La police a annulé l'appel : ${a.address}. Tu n'as plus à y aller.`,
      action_url: '/dashboard',
      data: { appel_id: a.id },
    }).catch(() => {})
    return NextResponse.json({ ok: true })
  }
  if (a.driver_id !== u.id) return NextResponse.json({ error: 'Cet appel est confié à un autre chauffeur.' }, { status: 403 })
  if (a.status === 'annule') return NextResponse.json({ error: 'Le dispatch a annulé cet appel.' }, { status: 409 })
  if (b?.action === 'accepter') {
    if (a.status === 'envoye') await sb.from('appels_police').update({ status: 'accepte', accepted_at: now }).eq('id', a.id).eq('status', 'envoye')
    return NextResponse.json({ ok: true })
  }
  if (b?.action === 'lier') {
    const missionId = b?.mission_id ? String(b.mission_id) : null
    await sb.from('appels_police').update({ status: 'complete', completed_at: now, mission_id: missionId, ...(a.accepted_at ? {} : { accepted_at: now }) }).eq('id', a.id)
    if (missionId) await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: u.id, action: 'note', notes: `Appel police envoyé par le dispatch (${a.address}), complété par le chauffeur.` }).then(() => {}, () => {})
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}

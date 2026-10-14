// POST /api/missions/[id]/consigne-lue — le chauffeur confirme avoir lu la consigne du garage (dépôt hors créneau,
// Olivier 10/10/2026). Tracé sur la fiche et dans l'historique.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Avec { employe } : DÉROGATION — un employé du garage accepte le véhicule malgré l'heure (Olivier 14/10/2026).
// Le nom de l'employé et l'heure sont gardés sur la fiche et le dispatch est prévenu.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const employe = String(body?.employe || '').trim().slice(0, 80)
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name, role, roles').eq('email', u.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, destination_address, assigned_to, source_notice_ack_at').eq('id', params.id).maybeSingle()
  if (!m || !me) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const bureau = [me.role, ...(me.roles || [])].some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  if (m.assigned_to !== me.id && !bureau) return NextResponse.json({ error: 'Mission non attribuée' }, { status: 403 })
  if (!m.source_notice_ack_at) {
    const now = new Date().toISOString()
    await sb.from('incoming_missions').update({ source_notice_ack_at: now, source_notice_ack_by: me.id, updated_at: now }).eq('id', m.id).is('source_notice_ack_at', null)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: me.id, action: 'source_notice_ack', notes: `Consigne du garage (dépôt hors heures d’ouverture) lue et confirmée par ${me.name || 'le chauffeur'}.` }).then(() => {}, () => {})
  }
  if (employe) {
    if (employe.length < 2) return NextResponse.json({ error: 'Nom de l’employé requis' }, { status: 400 })
    const now = new Date().toISOString()
    const heure = new Date().toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
    await sb.from('incoming_missions').update({ depot_derogation: { employe, at: now, par: me.id, par_nom: me.name || null }, updated_at: now }).eq('id', m.id)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: me.id, action: 'depot_derogation',
      notes: `Dépôt en dehors des heures du garage accepté par ${employe} (employé du garage) à ${heure} — déclaré par ${me.name || 'le chauffeur'}.`,
      metadata: { employe } }).then(() => {}, () => {})
    try {
      const { sendPushToRole } = await import('@/lib/push')
      await sendPushToRole(['dispatcher', 'admin', 'superadmin'], { title: `🕘 Dépôt après fermeture accepté`, body: `#${m.mission_number ?? ''} ${m.vehicle_plate || ''} : ${employe} (garage) réceptionne le véhicule à ${heure}.`.replace(/\s+/g, ' '), url: `/dispatch/${m.id}`, icon: '/icons/apple-touch-icon.png' })
    } catch { /* la notification est un plus */ }
  }
  return NextResponse.json({ ok: true })
}

// POST /api/espace/missions/[id]/annulation — { motif }
// Même règle que l'ancien portail garage : pas encore validée par le dispatch → annulée tout de suite, sans frais ;
// déjà validée → demande d'annulation que le dispatch tranche (annulation totale, trajet à vide facturé, ou refus).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getEspaceSession } from '@/lib/espace/session'
import { missionVisible } from '@/lib/espace/missions'
import { sendNotificationToRoles } from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const m = await missionVisible(params.id, s.compte, s.societes)
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (['completed', 'to_invoice', 'cancelled'].includes(m.status)) return NextResponse.json({ error: 'Cette intervention est déjà terminée ou annulée.' }, { status: 400 })
  const motif = String((await req.json().catch(() => ({})))?.motif || '').trim().slice(0, 500)
  const sb = createAdminClient()
  const now = new Date().toISOString()

  if (m.status === 'new') {
    await sb.from('incoming_missions').update({ status: 'cancelled', cancelled_at: now, cancelled_reason: `Annulée par le client depuis l’espace client (${s.compte.nom})${motif ? ` : ${motif}` : ''}`, updated_at: now }).eq('id', m.id).eq('status', 'new')
    await sb.from('mission_logs').insert({ mission_id: m.id, action: 'cancelled', notes: `Annulée par ${s.compte.nom} depuis l’espace client avant validation${motif ? ` — ${motif}` : ''}.` }).then(() => {}, () => {})
    await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'espace_client_demande', {
      title: '✕ Demande annulée par le client', body: `#${m.mission_number} ${m.vehicle_plate || ''} — annulée avant validation${motif ? ` : ${motif}` : ''}.`, action_url: `/dispatch/${m.id}`, mission_id: m.id,
    }).catch(() => {})
    return NextResponse.json({ ok: true, direct: true, message: 'Intervention annulée, sans frais.' })
  }

  const { data: existe } = await sb.from('garage_cancellation_requests').select('id').eq('mission_id', m.id).eq('status', 'pending').maybeSingle()
  if (existe) return NextResponse.json({ ok: true, enAttente: true, message: 'Une demande d’annulation est déjà en cours d’examen.' })
  let garageId = m.requested_by_garage_id
  if (!garageId) {
    const soc = s.societes.find(x => x.odoo_partner_id === m.billed_to_id)
    const { data: gp } = soc ? await sb.from('garage_partners').select('id').eq('odoo_partner_id', soc.odoo_partner_id).limit(1) : { data: [] as any[] }
    garageId = gp?.[0]?.id || null
  }
  const { error } = await sb.from('garage_cancellation_requests').insert({ mission_id: m.id, requested_by_garage_id: garageId, requested_by_user_id: null, reason: `${motif || 'sans motif'} — demandé par ${s.compte.nom} (espace client)`, status: 'pending' })
  if (error) return NextResponse.json({ error: 'La demande n’a pas pu être enregistrée. Appelez-nous.' }, { status: 500 })
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'garage_cancel_request', {
    title: '🛑 Annulation demandée par un client', body: `Mission #${m.mission_number}${m.vehicle_plate ? ' · ' + m.vehicle_plate : ''} — ${motif || 'sans motif'}. À décider.`, action_url: '/admin/garage-cancellations', mission_id: m.id,
  }).catch(() => {})
  return NextResponse.json({ ok: true, enAttente: true, message: 'Demande d’annulation envoyée : notre équipe vous répond rapidement.' })
}

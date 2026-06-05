// src/app/api/admin/missions/[id]/fix-billing/route.ts
//
// POST /api/admin/missions/[id]/fix-billing
// Pour les missions qui ont ete encaissees AVANT le fix auto-restitution +
// auto-create partner (commit 1e3e46e du 2026-06-03). Relance la logique :
//   - findOrCreatePartner Odoo si billed_to_id manque (utilise client_name
//     depuis l intervention liee)
//   - Restitue la mission si encore en parked + source fourriere

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { findOrCreatePartner, withOdooActor } from '@/lib/odoo'
import { releaseParcAndShift } from '@/lib/parc/release'
import { parseAddressForOdoo } from '@/app/api/interventions/route'

const FOURRIERE_AUTO_RESTITUTE_SOURCES = [
  'police_mg', 'police_avp', 'police_rodeo', 'police_accident',
  'police_saisie', 'police_snc', 'sia_couvert', 'prive',
]

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  // Olivier 2026-06-05 : recupere l user.id pour withOdooActor
  const { data: actorUser } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()
  const actorId = actorUser?.id || null

  // Charge mission + dernier encaissement
  const { data: mission, error: e1 } = await sb
    .from('incoming_missions')
    .select('id, status, source, billed_to_id, billed_to_name, parc_zone_key')
    .eq('id', params.id)
    .single()
  if (e1 || !mission) return NextResponse.json({ error: e1?.message || 'Mission introuvable' }, { status: 404 })

  const { data: intervention } = await sb
    .from('interventions')
    .select('client_name, client_phone, client_email, client_address, client_vat, amount, payment_mode')
    .eq('mission_id', params.id)
    .eq('service_type', 'encaissement')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const actions: string[] = []

  // 1. Auto-create partner Odoo si manquant
  let partnerId: number | null = mission.billed_to_id
  if (!partnerId && intervention?.client_name) {
    try {
      const addr = parseAddressForOdoo(intervention.client_address)
      // Olivier 2026-06-05 : wrap dans withOdooActor (cle perso admin)
      partnerId = await withOdooActor(actorId, () => findOrCreatePartner({
        name:     intervention.client_name,
        phone:    intervention.client_phone || undefined,
        email:    intervention.client_email || undefined,
        street:   addr.street || undefined,
        zip:      addr.zip || undefined,
        city:     addr.city || undefined,
        vat:      intervention.client_vat || undefined,
        countryCode: 'BE',
      }))
      if (partnerId) {
        await sb.from('incoming_missions').update({
          billed_to_id:   partnerId,
          billed_to_name: mission.billed_to_name || intervention.client_name,
        }).eq('id', params.id)
        actions.push(`partner Odoo cree/lie (id=${partnerId})`)
      }
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `findOrCreatePartner KO : ${e.message}`, actions }, { status: 500 })
    }
  }

  // 2. Auto-restituer si encore en parked + source fourriere
  if (mission.status === 'parked' && FOURRIERE_AUTO_RESTITUTE_SOURCES.includes(mission.source || '')) {
    await sb.from('incoming_missions').update({
      status:       'to_invoice',
      completed_at: new Date().toISOString(),
    }).eq('id', params.id)
    if (mission.parc_zone_key) {
      await releaseParcAndShift(sb, params.id)
      actions.push(`parc libere (zone ${mission.parc_zone_key})`)
    }
    actions.push('status -> to_invoice')
  }

  return NextResponse.json({
    ok: true,
    mission_id: params.id,
    billed_to_id: partnerId,
    actions: actions.length > 0 ? actions : ['rien a faire (deja OK)'],
  })
}

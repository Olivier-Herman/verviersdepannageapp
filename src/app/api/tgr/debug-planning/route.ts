// src/app/api/tgr/debug-planning/route.ts
//
// Diagnostic superadmin : tente de créer la mission « planning » pour une demande
// TGR donnée et renvoie l'ERREUR BRUTE Supabase si l'insert échoue. Contourne le
// blocage « déjà traitée » (marche même sur une TGR déjà acceptée). Si l'insert
// réussit, la mission est bien créée (c'est le but) → idempotent (external_id).
//
// GET /api/tgr/debug-planning?tgr=<id ou référence>

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : ((session.user as any).role ? [(session.user as any).role] : [])
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const key = (new URL(req.url).searchParams.get('tgr') || '').trim()

  const sb = createAdminClient()
  // Sans paramètre (ou tgr=last) : on prend la DERNIÈRE demande TGR créée.
  let mission: any = null
  if (!key || key.toLowerCase() === 'last') {
    const { data } = await sb.from('tgr_missions').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle()
    mission = data
  } else {
    const isUuid = /-/.test(key)
    const { data } = isUuid
      ? await sb.from('tgr_missions').select('*').eq('id', key).maybeSingle()
      : await sb.from('tgr_missions').select('*').eq('reference', key).maybeSingle()
    mission = data
  }
  if (!mission) return NextResponse.json({ error: 'Demande TGR introuvable (aucune demande TGR en base ?)' }, { status: 404 })

  const m: any = mission
  const dateOnly = m.deadline_date ? String(m.deadline_date).slice(0, 10) : null
  const hour = m.deadline_slot === 'before_noon' ? 10 : m.deadline_slot === 'during_day' ? 14 : 9
  const interventionDate = dateOnly
    ? new Date(`${dateOnly}T${String(hour).padStart(2, '0')}:00:00`).toISOString()
    : new Date().toISOString()

  const extId = `tgr_${m.id}`
  const payload: Record<string, any> = {
    external_id:        extId,
    source:             'tgr',
    source_format:      'tgr',
    status:             'dispatching',
    dispatch_mode:      'manual',
    mission_type:       'remorquage',
    dossier_number:     m.reference || null,
    client_name:        null,
    billed_to_name:     null,
    vehicle_plate:      m.plate || null,
    vehicle_brand:      m.brand || null,
    vehicle_model:      m.model || null,
    is_rollable:        m.is_rolling ?? null,
    incident_address:   m.pickup_address || null,
    destination_address: m.delivery_address || null,
    remarks_general:    m.remarks || null,
    intervention_date:  interventionDate,
    rdv_at:             interventionDate,
    received_at:        new Date().toISOString(),
    parse_confidence:   1.0,
    distance_km:        m.distance_km ?? null,
  }

  const { data: existing } = await sb.from('incoming_missions').select('id').eq('external_id', extId).maybeSingle()

  // Tente colonne par colonne d'abord un insert minimal, puis complet, pour isoler
  // la colonne fautive si erreur.
  let result: any
  if (existing) {
    const { error } = await sb.from('incoming_missions').update(payload).eq('id', existing.id)
    result = { action: 'update', missionId: existing.id, error: error?.message || null, code: (error as any)?.code || null, details: (error as any)?.details || null }
  } else {
    const { data: ins, error } = await sb.from('incoming_missions').insert(payload).select('id').single()
    result = { action: 'insert', missionId: ins?.id || null, error: error?.message || null, code: (error as any)?.code || null, details: (error as any)?.details || null, hint: (error as any)?.hint || null }
  }

  return NextResponse.json({
    tgr: { id: m.id, reference: m.reference, status: m.status, deadline_date: m.deadline_date, deadline_slot: m.deadline_slot },
    interventionDate,
    payloadKeys: Object.keys(payload),
    result,
  })
}

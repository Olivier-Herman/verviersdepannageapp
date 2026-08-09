// src/app/api/missions/[id]/vab-close/route.ts
//
// POST — clôture la mission chez VAB Comet (remorquage/tow ou dépannage/breakdown)
// en rejouant la séquence via closeVabMission (state-aware, chaînage OSVSTATE).
// Appelé par l'écran de clôture chauffeur. Body :
//   { signaturePng?, refusal?, notPresent?, keysNr?, keyLocation?, vehicleLocation?,
//     receiverName?, receiverFirstName?, interventionDate?, interventionTime?, present? }
// Réservé au chauffeur assigné / dispatch / admin. Olivier 2026-08-08.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { closeVabMission }   from '@/lib/vab/close'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere'] })

  const isUuid = /^[0-9a-f-]{36}$/i.test(params.id)
  const q = sb.from('incoming_missions').select('id, source, external_id, mission_type, assigned_to, mission_number, status, requisitoire_at, vab_closed_at')
  const { data: m } = await (isUuid ? q.eq('id', params.id) : q.eq('mission_number', Number(params.id))).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Autorisation : chauffeur assigné OU admin/superadmin/dispatcher OU module fourriere.
  const allowed = (m.assigned_to && m.assigned_to === acc.id) || acc.ok
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  if (String(m.source).toLowerCase() !== 'vab') return NextResponse.json({ error: 'Mission non VAB' }, { status: 400 })
  const assignmentId = String(m.external_id || '').match(/\d+/)?.[0]
  if (!assignmentId) return NextResponse.json({ error: 'AssignmentId VAB introuvable sur la fiche' }, { status: 400 })
  if (m.vab_closed_at) return NextResponse.json({ ok: true, alreadyClosed: true })

  const b = await req.json().catch(() => ({}))
  const taskType: 'tow' | 'breakdown' = String(m.mission_type || '').toLowerCase().includes('remorquage') ? 'tow' : 'breakdown'

  let result
  try {
    result = await closeVabMission({
      assignmentId, taskType,
      signaturePng:      b.signaturePng || undefined,
      refusal:           !!b.refusal,
      notPresent:        !!b.notPresent,
      keysNr:            b.keysNr || undefined,
      keyLocation:       b.keyLocation || undefined,
      vehicleLocation:   b.vehicleLocation || undefined,
      receiverName:      b.receiverName || undefined,
      receiverFirstName: b.receiverFirstName || undefined,
      interventionDate:  b.interventionDate || undefined,
      interventionTime:  b.interventionTime || undefined,
      present:           b.present !== false,
      extraFields:       (b.extraFields && typeof b.extraFields === 'object') ? b.extraFields : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Clôture VAB échouée : ${e?.message || e}` }, { status: 500 })
  }

  if (result.completed) {
    await sb.from('incoming_missions').update({ vab_closed_at: new Date().toISOString() }).eq('id', m.id)
    await sb.from('mission_logs').insert({
      mission_id: m.id, action: 'vab_closed',
      notes: `Mission clôturée chez VAB (${result.steps.join(' → ')}).`,
      metadata: { assignmentId, steps: result.steps },
    }).then(() => {}, () => {})
  }

  return NextResponse.json({ ok: result.completed, completed: result.completed, steps: result.steps, error: result.error, lastButtons: result.lastButtons })
}

// src/app/api/missions/[id]/scratch/route.ts
//
// POST /api/missions/[id]/scratch { reason? }
//
// Olivier 2026-06-08 : passe un vehicule en epave / scratch cote VD Soft.
//   - status -> 'completed' (sortie du parc)
//   - parc_zone_key/row/slot -> null (libere la position)
//   - completed_at = now
//   - mission_logs action='scratched' pour traceabilite
//
// Optionnel : si odoo_helpdesk_id existe, on tente aussi de pousser
// vers Odoo state_id=24 (Scratch) en best-effort. Si Odoo KO, le
// changement reste valide cote VD Soft.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { withOdooActor, odooRpc } from '@/lib/odoo'
import { SCRATCH_STATE_ID }  from '@/lib/fourriere'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!modules.includes('fourriere') && !['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden : module fourriere requis' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const reason = String(body.reason || '').trim() || null

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()

  // 1. Charge mission
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, status, parc_zone_key, odoo_vehicle_id, odoo_helpdesk_id')
    .eq('id', params.id)
    .maybeSingle()
  if (mErr || !mission) {
    return NextResponse.json({ error: `Mission introuvable : ${mErr?.message || 'unknown'}` }, { status: 404 })
  }

  // 2. Update VD Soft : sortie du parc + status completed
  const nowIso = new Date().toISOString()
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      status:          'completed',
      completed_at:    nowIso,
      parc_zone_key:   null,
      parc_row_number: null,
      parc_slot_index: null,
      closing_notes:   reason
        ? `Mis en épave : ${reason}`
        : 'Mis en épave',
      updated_at:      nowIso,
    })
    .eq('id', params.id)
  if (upErr) return NextResponse.json({ error: `Update KO : ${upErr.message}` }, { status: 500 })

  // 3. Log mission_logs
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    action:     'scratched',
    notes:      reason ? `Scratch / épave : ${reason}` : 'Scratch / mis en épave',
    actor_id:   actor?.id || null,
    metadata:   {
      from_zone:   mission.parc_zone_key,
      from_status: mission.status,
      reason,
    },
  }).then(() => {}, e => console.warn(`[scratch] log KO mission=${params.id}:`, e?.message))

  // 4. Best-effort Odoo : si vehicle_id present, update state_id=24 (Scratch)
  let odooUpdated = false
  let odooError: string | null = null
  if (mission.odoo_vehicle_id) {
    try {
      await withOdooActor(actor?.id, async () => {
        await odooRpc('fleet.vehicle', 'write', [[mission.odoo_vehicle_id], { state_id: SCRATCH_STATE_ID }])
      })
      odooUpdated = true
    } catch (e: any) {
      odooError = String(e?.message || e).slice(0, 200)
      console.warn(`[scratch] Odoo update KO mission=${params.id}:`, e?.message)
    }
  }

  return NextResponse.json({
    ok: true,
    mission_id: params.id,
    mission_number: mission.mission_number,
    odoo_updated: odooUpdated,
    odoo_error:   odooError,
    message: `Véhicule ${mission.vehicle_plate || '#' + mission.mission_number} mis en épave${odooUpdated ? ' (Odoo synced)' : ''}`,
  })
}

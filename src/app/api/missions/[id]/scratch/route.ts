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
import { scratchMission }    from '@/lib/missions/scratch'

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

  const r = await scratchMission(sb, params.id, actor?.id || null, reason)
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.exit_control_blocked ? { exit_control_blocked: true } : {}) }, { status: r.status })
  const { mission, odooUpdated, odooError } = r

  return NextResponse.json({
    ok: true,
    mission_id: params.id,
    mission_number: mission.mission_number,
    odoo_updated: odooUpdated,
    odoo_error:   odooError,
    message: `Véhicule ${mission.vehicle_plate || '#' + mission.mission_number} mis en épave${odooUpdated ? ' (Odoo synced)' : ''}`,
  })
}

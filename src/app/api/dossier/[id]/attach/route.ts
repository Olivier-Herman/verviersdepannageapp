// src/app/api/dossier/[id]/attach/route.ts
//
// POST { mission_id } — rattache à la main une fiche orpheline (mail annulé,
// ignoré, doublon, fiche « à vérifier ») au dossier : elle devient enfant de la
// racine et apparaît dans la chronologie. Hors fenêtre automatique (J-3 → sortie
// +7), c'est le seul moyen. Refus si la fiche est une action vivante d'un autre
// dossier (assignée, en cours, facturée…). Olivier 07/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ATTACHABLE = new Set(['cancelled', 'ignored', 'parse_error', 'duplicate', 'new'])

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin', 'dispatcher'].includes(String(user.role || ''))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const missionId = String(body.mission_id || '')
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: any0 } = await sb.from('incoming_missions').select('id, parent_mission_id, mission_number, vehicle_plate').eq('id', params.id).maybeSingle()
  if (!any0) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const rootId = (any0 as any).parent_mission_id || (any0 as any).id
  const { data: root } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate').eq('id', rootId).maybeSingle()
  const { data: m } = await sb.from('incoming_missions').select('id, status, parent_mission_id, dossier_leg, vehicle_plate, mission_number, source').eq('id', missionId).maybeSingle()
  if (!m || !root) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  if ((m as any).dossier_leg) return NextResponse.json({ error: 'Une fiche gardiennage ne se rattache pas à la main' }, { status: 400 })
  if ((m as any).id === (root as any).id) return NextResponse.json({ error: 'C’est déjà la racine du dossier' }, { status: 400 })
  if ((m as any).parent_mission_id === (root as any).id) return NextResponse.json({ ok: true, already: true })
  if (!ATTACHABLE.has(String((m as any).status))) {
    return NextResponse.json({ error: `Cette fiche est une action vivante (${(m as any).status}) : on ne la rattache pas à la main, elle appartient à son propre dossier.` }, { status: 409 })
  }
  const now = new Date().toISOString()
  await sb.from('incoming_missions').update({ parent_mission_id: (root as any).id, updated_at: now }).eq('id', missionId)
  const note = `Rattachée à la main au dossier #${(root as any).mission_number} (${(root as any).vehicle_plate || ''}) par ${user.name || user.email || 'dispatch'}`
  await sb.from('mission_logs').insert([
    { mission_id: missionId, actor_id: user.id || null, action: 'attached_to_dossier', notes: note, metadata: { root_id: (root as any).id } },
    { mission_id: (root as any).id, actor_id: user.id || null, action: 'mail_attached', notes: `Mail ${(m as any).source || ''} #${(m as any).mission_number ?? ''} rattaché à la main au dossier (${(m as any).status})`, metadata: { mission_id: missionId } },
  ]).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}

// src/app/api/missions/update-vehicle/route.ts
//
// POST { mission_id, vehicle_plate?, vehicle_brand?, vehicle_model?, vehicle_vin? }
//
// Persiste la modification véhicule faite par le chauffeur depuis sa fiche
// (VehSheet). Olivier 2026-06-17 : cette route manquait → le POST faisait 404
// (avalé par le .catch côté UI), la modif ne persistait pas (revert au refresh).
//
// Accès : le chauffeur assigné à la mission, ou le staff (admin/superadmin/
// dispatcher/fourrière).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = ['admin', 'superadmin', 'dispatcher']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const missionId = body.mission_id ? String(body.mission_id) : null
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb
    .from('users').select('id, role, roles, modules').eq('email', session.user!.email!).single()
  if (!actor) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })

  const { data: mission } = await sb
    .from('incoming_missions').select('id, assigned_to').eq('id', missionId).single()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const roles: string[] = [actor.role, ...(Array.isArray(actor.roles) ? actor.roles : [])].filter(Boolean)
  const modules: string[] = Array.isArray((actor as any).modules) ? (actor as any).modules : []
  const isStaff = roles.some(r => STAFF_ROLES.includes(r)) || modules.includes('fourriere')
  if (mission.assigned_to !== actor.id && !isStaff) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // On ne met à jour que les champs fournis (non vides pour les valeurs texte).
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.vehicle_plate !== undefined) updates.vehicle_plate = (body.vehicle_plate || '').toUpperCase().trim() || null
  if (body.vehicle_brand !== undefined) updates.vehicle_brand = (body.vehicle_brand || '').trim() || null
  if (body.vehicle_model !== undefined) updates.vehicle_model = (body.vehicle_model || '').trim() || null
  if (body.vehicle_vin   !== undefined) updates.vehicle_vin   = (body.vehicle_vin   || '').toUpperCase().trim() || null
  // Lien véhicule Odoo (sélectionné dans la liste proposée, ou nouvellement créé
  // côté client via /api/odoo/create-vehicle). Olivier 2026-06-17.
  if (body.odoo_vehicle_id !== undefined) {
    updates.odoo_vehicle_id = body.odoo_vehicle_id ? Number(body.odoo_vehicle_id) : null
  }

  const { data: updated, error } = await sb
    .from('incoming_missions').update(updates).eq('id', missionId)
    .select('id, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, odoo_vehicle_id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: actor.id, action: 'update_vehicle',
    notes: 'Véhicule modifié (chauffeur)', metadata: updates,
  })

  return NextResponse.json({ ok: true, mission: updated })
}

// /api/missions/[id]/truck — mission d'un chauffeur sans camion (Olivier 26/10/2026 : « on ne peut pas avoir une
// mission avec chauffeur sans camion »). La fiche demande au chauffeur avec quel camion il roule.
//   GET  → { trucks: [{ id, name, plate, brand, model, used_by }], current_truck_id, truck_id }
//   POST { truck_id } → camion posé sur la mission (si elle n'en a pas encore) et devient son camion du moment.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function moi() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const { data } = await createAdminClient().from('users').select('id, name, current_truck_id').eq('email', session.user.email).maybeSingle()
  return data
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await moi()
  if (!me) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const sb = createAdminClient()
  const [{ data: m }, { data: trucks, error }, { data: users }] = await Promise.all([
    sb.from('incoming_missions').select('id, truck_id, assigned_to').eq('id', params.id).maybeSingle(),
    sb.from('trucks').select('id, name, plate, brand, model').eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
    sb.from('users').select('id, name, current_truck_id').eq('active', true).not('current_truck_id', 'is', null),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const usedBy = new Map<string, string>()
  for (const u of users || []) if (u.id !== me.id && u.current_truck_id) usedBy.set(u.current_truck_id, String(u.name || '').split(' ')[0])
  return NextResponse.json({
    truck_id: m.truck_id, current_truck_id: me.current_truck_id,
    trucks: (trucks || []).map((t: any) => ({ ...t, used_by: usedBy.get(t.id) || null })),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await moi()
  if (!me) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  const truckId = String(b.truck_id || '').trim()
  if (!truckId) return NextResponse.json({ error: 'Camion requis' }, { status: 400 })
  const sb = createAdminClient()
  const [{ data: m }, { data: t }] = await Promise.all([
    sb.from('incoming_missions').select('id, truck_id, assigned_to').eq('id', params.id).maybeSingle(),
    sb.from('trucks').select('id, name, plate').eq('id', truckId).eq('active', true).maybeSingle(),
  ])
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!t) return NextResponse.json({ error: 'Camion introuvable' }, { status: 400 })
  if (m.assigned_to !== me.id) return NextResponse.json({ error: 'Cette mission ne t’est pas attribuée' }, { status: 403 })
  const now = new Date().toISOString()
  // Le camion de la mission ne s'écrase jamais (c'est avec lui qu'on a roulé) : seulement s'il manque.
  if (!m.truck_id) {
    const { error } = await sb.from('incoming_missions').update({ truck_id: t.id, updated_at: now }).eq('id', m.id).is('truck_id', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: me.id, action: 'truck_set', notes: `Camion choisi par le chauffeur : ${t.name} (${t.plate})`, metadata: { truck_id: t.id } })
  }
  await sb.from('users').update({ current_truck_id: t.id, current_truck_set_at: now, updated_at: now }).eq('id', me.id)
  return NextResponse.json({ ok: true, truck_id: m.truck_id || t.id })
}

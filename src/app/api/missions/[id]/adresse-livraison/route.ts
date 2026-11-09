// src/app/api/missions/[id]/adresse-livraison/route.ts
//
// Le chauffeur complète l'adresse de livraison d'une mission TERMINÉE dont la fiche n'a pas
// de rue (Olivier 09/11/2026, 2JXX385). Ce n'est pas une re-clôture : rien d'autre ne
// change sur la fiche. L'assistance est relancée tout de suite avec la bonne adresse.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { adresseComplete }   from '@/lib/address-parts'

export const dynamic     = 'force-dynamic'
// La clôture VAB relancée en tâche de fond dure 60-90 s.
export const maxDuration = 300

const BUREAU = ['dispatcher', 'admin', 'superadmin']

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id, role, roles').eq('email', session.user.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, assigned_to, external_id, destination_address, vab_assignment_ids, vab_closed_at, vehicle_location, key_location, key_recovered')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const a = actor as any
  const bureau = BUREAU.includes(String(a?.role)) || (Array.isArray(a?.roles) && a.roles.some((r: string) => BUREAU.includes(r)))
  if (!a || ((m as any).assigned_to !== a.id && !bureau)) return NextResponse.json({ error: 'Pas ta mission' }, { status: 403 })
  if (!['completed', 'to_invoice'].includes(String((m as any).status))) {
    return NextResponse.json({ error: 'Mission pas terminée' }, { status: 409 })
  }
  if (adresseComplete((m as any).destination_address)) {
    return NextResponse.json({ error: "L'adresse est déjà complète" }, { status: 409 })
  }

  const body = await req.json().catch(() => ({}))
  const address = String(body?.address || '').trim()
  if (!adresseComplete(address)) return NextResponse.json({ error: 'Il manque la rue ou le code postal' }, { status: 400 })
  // Adresse choisie dans les suggestions (position connue), jamais un texte libre (Olivier 09/11/2026).
  if (!Number.isFinite(body?.lat) || !Number.isFinite(body?.lng)) return NextResponse.json({ error: 'Choisis l’adresse dans les suggestions' }, { status: 400 })

  const patch: Record<string, any> = { destination_address: address, updated_at: new Date().toISOString() }
  if (body?.name) patch.destination_name = String(body.name).trim()
  if (Number.isFinite(body?.lat)) patch.destination_lat = body.lat
  if (Number.isFinite(body?.lng)) patch.destination_lng = body.lng
  const { error } = await sb.from('incoming_missions').update(patch).eq('id', (m as any).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: (m as any).id, actor_id: a.id, action: 'destination_completee',
    notes: `Adresse de livraison complétée : ${(m as any).destination_address || '—'} → ${address}`,
    metadata: { avant: (m as any).destination_address || null, apres: address, via: 'mission_terminee' },
  }).then(() => {}, () => {})

  // Dossier VAB encore ouvert : on relance la clôture avec la nouvelle adresse, sans attendre le filet.
  const vab = Array.isArray((m as any).vab_assignment_ids) && (m as any).vab_assignment_ids.length > 0 && !(m as any).vab_closed_at
  if (vab) {
    const { runVabTowClose } = await import('@/lib/cloture/transform/vab')
    const task = runVabTowClose({
      missionId: (m as any).id, externalId: (m as any).external_id, actorId: a.id,
      vehicleLocation: (m as any).vehicle_location ?? null, keyLocation: (m as any).key_location ?? null,
      keyRecovered: (m as any).key_recovered ?? null,
    }).catch(() => {})
    try { const { waitUntil } = await import('@vercel/functions'); waitUntil(task) } catch { /* hors Vercel */ }
  }
  return NextResponse.json({ ok: true, vabRelance: vab })
}

// src/app/api/missions/[id]/saisie-temp-cycle/route.ts
//
// POST /api/missions/[id]/saisie-temp-cycle
//   { action: 'garage_out' | 'return', zone_key? }
//
// Cycle d'une levée de saisie TEMPORAIRE (Olivier 2026-06-13, Phase 3) :
//   - garage_out : le véhicule est confié à un garagiste -> sort du parc
//                  (libère l'emplacement) + temp_garage_out_at.
//   - return     : le véhicule revient -> ré-entrée parc sur le MÊME dossier
//                  (assigne une zone) + temp_returned_at. Le gardiennage
//                  « hors période saisie » (20 €/j) court à partir de ce retour.
//
// La sortie DÉFINITIVE se fait ensuite via la restitution / encaissement
// habituelle (le blocage police est déjà levé par la levée de saisie).
//
// Accès : module fourrière / admin / superadmin.

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'

export const dynamic = 'force-dynamic'

interface Body { action: 'garage_out' | 'return'; zone_key?: string }

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!modules.includes('fourriere') && !['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden : module fourrière requis' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as Body
  const action = body.action

  const sb = createAdminClient()
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, source, status, levee_saisie_type, temp_garage_out_at, temp_returned_at, parc_zone_key')
    .eq('id', params.id)
    .single()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.source !== 'police_saisie') {
    return NextResponse.json({ error: 'Réservé aux missions Police Saisie.' }, { status: 400 })
  }
  if (mission.levee_saisie_type !== 'temporaire') {
    return NextResponse.json({ error: 'Cycle réservé aux levées de saisie temporaires.' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // ── Sortie vers garagiste ──────────────────────────────────────────────────
  if (action === 'garage_out') {
    if (mission.temp_garage_out_at && !mission.temp_returned_at) {
      return NextResponse.json({ error: 'Véhicule déjà sorti vers le garagiste.' }, { status: 400 })
    }
    // Libère l'emplacement physique (le véhicule quitte le parc)
    if (mission.parc_zone_key) await releaseParcAndShift(sb, params.id)
    const { error: upErr } = await sb
      .from('incoming_missions')
      .update({ temp_garage_out_at: now, temp_returned_at: null, updated_at: now })
      .eq('id', params.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    await sb.from('mission_logs').insert({
      mission_id: params.id, actor_id: user.id, action: 'saisie_garage_out',
      notes: `Levée temporaire — véhicule confié au garagiste (sorti du parc) par ${user.name || user.email}`,
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, action, message: 'Véhicule sorti vers le garagiste.' })
  }

  // ── Retour en parc (même dossier) ──────────────────────────────────────────
  if (action === 'return') {
    if (!mission.temp_garage_out_at) {
      return NextResponse.json({ error: 'Le véhicule n\'est pas sorti vers le garagiste.' }, { status: 400 })
    }
    if (mission.temp_returned_at) {
      return NextResponse.json({ error: 'Véhicule déjà revenu en parc.' }, { status: 400 })
    }
    const zoneKey = String(body.zone_key || '').trim()
    if (!zoneKey) return NextResponse.json({ error: 'zone_key requis pour le retour en parc.' }, { status: 400 })

    const { data: zone, error: zErr } = await sb
      .from('parc_zones').select('key, active').eq('key', zoneKey).single()
    if (zErr || !zone)   return NextResponse.json({ error: `Zone ${zoneKey} introuvable` }, { status: 400 })
    if (!zone.active)    return NextResponse.json({ error: `Zone ${zoneKey} inactive` }, { status: 400 })

    const { error: upErr } = await sb
      .from('incoming_missions')
      .update({
        status:          'parked',
        parc_zone_key:   zoneKey,
        parc_row_number: null,
        parc_slot_index: null,
        temp_returned_at: now,
        updated_at:      now,
      })
      .eq('id', params.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    await sb.from('mission_logs').insert({
      mission_id: params.id, actor_id: user.id, action: 'saisie_return_parc',
      notes: `Levée temporaire — retour en parc zone ${zoneKey} (même dossier) par ${user.name || user.email}`,
      metadata: { zone_key: zoneKey },
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, action, message: `Véhicule revenu en parc (zone ${zoneKey}).` })
  }

  return NextResponse.json({ error: 'Action invalide (garage_out | return).' }, { status: 400 })
}

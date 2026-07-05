// src/app/api/dossier/[id]/route.ts
//
// LECTURE SEULE. Agrège la chaîne d'un dossier (REM parent + mise en parc + REL
// enfant(s)) en "legs" lettrés -A/-B/-C… pour la vue dossier unifiée (preview).
// Ne touche à AUCUN chemin d'écriture existant.
//
// Modèle : le n° dossier = la racine (le REM). Chaque leg réel/gardiennage reçoit
// une lettre dans l'ordre chronologique. Le parc est un leg à part (gardiennage).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getMissionTypeLabel } from '@/lib/missions/mission-types'

export const dynamic = 'force-dynamic'

const COLS = `id, mission_number, external_id, dossier_number, source, status, mission_type,
  parent_mission_id, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
  client_name, client_phone, billed_to_id, billed_to_name,
  incident_address, destination_address, redelivery_address,
  assigned_to, received_at, intervention_date, parked_at, loaded_at, delivering_at,
  completed_at, parc_zone_key`

const DAY_MS = 86_400_000

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const { data: m0 } = await sb.from('incoming_missions').select(COLS).eq('id', params.id).maybeSingle()
  if (!m0) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })

  // Racine = le REM sans parent (le point d'entrée peut être le REM ou la REL).
  let root: any = m0
  if ((m0 as any).parent_mission_id) {
    const { data: p } = await sb.from('incoming_missions').select(COLS).eq('id', (m0 as any).parent_mission_id).maybeSingle()
    if (p) root = p
  }

  // Enfants (REL…) non annulés/ignorés.
  const { data: childrenRaw } = await sb.from('incoming_missions').select(COLS)
    .eq('parent_mission_id', root.id)
    .not('status', 'in', '("cancelled","ignored")')
    .order('received_at', { ascending: true })
  const children: any[] = childrenRaw || []

  // Noms chauffeurs.
  const driverIds = Array.from(new Set([root, ...children].map(x => x.assigned_to).filter(Boolean)))
  const nameById: Record<string, string> = {}
  if (driverIds.length) {
    const { data: us } = await sb.from('users').select('id, name').in('id', driverIds)
    for (const u of us || []) nameById[(u as any).id] = (u as any).name
  }

  const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : null)

  // ── Construction des legs ────────────────────────────────────────────────
  const legs: any[] = []

  // Leg REM (toujours) — CARTE : mappe la ligne racine (fiche embarquée complète).
  const remLeg: any = {
    kind:            'rem',
    mission_id:      root.id,
    mission_number:  root.mission_number,
    status:          root.status,
    title:           getMissionTypeLabel(root.mission_type, 'long'),
    billed_to_name:  root.billed_to_name || null,
    driver_name:     root.assigned_to ? (nameById[root.assigned_to] || null) : null,
    started_at:      root.received_at || root.intervention_date || null,
    is_card:         true,
    details: {
      incident_address:    root.incident_address || null,
      destination_address: root.destination_address || null,
      source:              root.source,
    },
  }
  legs.push(remLeg)

  // « Leg » PARC / GARDIENNAGE : PAS une carte (le parc est un état du REM, sa
  // fiche est celle du remorquage). On garde la lettre -B pour l'historique + le
  // comptage des jours, et on reflète le gardiennage sur la carte REM.
  if (root.parked_at) {
    const parkedMs = ts(root.parked_at)!
    const childLoaded = children.map(c => ts(c.loaded_at) || ts(c.delivering_at)).filter(Boolean) as number[]
    const exitMs = childLoaded.length ? Math.min(...childLoaded) : ts(root.completed_at) || Date.now()
    const days = Math.max(1, Math.ceil((exitMs - parkedMs) / DAY_MS))
    legs.push({
      kind:            'parc',
      mission_id:      root.id,
      mission_number:  root.mission_number,
      status:          'parked',
      title:           '🅿️ Mise en parc / gardiennage',
      billed_to_name:  root.billed_to_name || null,
      billed_inherited: true,
      driver_name:     null,
      started_at:      root.parked_at,
      is_card:         false,
      details:         { parc_zone_key: root.parc_zone_key || null, gardiennage_days: days, still_parked: root.status === 'parked' },
    })
    // Reflet sur la carte REM.
    remLeg.details.gardiennage_days = days
    remLeg.details.parc_zone_key    = root.parc_zone_key || null
    remLeg.details.still_parked     = root.status === 'parked'
  }

  // Legs REL (enfants) — CARTES.
  for (const c of children) {
    legs.push({
      kind:            'rel',
      mission_id:      c.id,
      mission_number:  c.mission_number,
      status:          c.status,
      title:           getMissionTypeLabel(c.mission_type, 'long'),
      billed_to_name:  c.billed_to_name || null,
      driver_name:     c.assigned_to ? (nameById[c.assigned_to] || null) : null,
      started_at:      c.received_at || c.intervention_date || null,
      is_card:         true,
      details: {
        incident_address:    c.incident_address || null,
        destination_address: c.destination_address || null,
        source:              c.source,
      },
    })
  }

  // Ordre chronologique → lettres A, B, C…
  legs.sort((a, b) => (ts(a.started_at) || 0) - (ts(b.started_at) || 0))
  const LETTERS = 'ABCDEFGHIJ'
  legs.forEach((leg, i) => { leg.letter = LETTERS[i] || String(i + 1) })
  // Dépliage par défaut : la CARTE la plus récente (le parc n'est pas une carte).
  const cardLegs = legs.filter(l => l.is_card)
  const lastCard = cardLegs.reduce((mx, leg) => (ts(leg.started_at) || 0) >= (ts(mx.started_at) || 0) ? leg : mx, cardLegs[0])
  legs.forEach(leg => { leg.is_last = !!lastCard && leg === lastCard })

  // ── Historique UNIFIÉ (toutes actions confondues, du début à la fin) ───────
  const chainIds = [root.id, ...children.map(c => c.id)]
  const { data: logs } = await sb.from('mission_logs')
    .select('mission_id, action, notes, created_at, actor_id')
    .in('mission_id', chainIds)
    .order('created_at', { ascending: false })
    .limit(300)
  const actorIds = Array.from(new Set((logs || []).map((l: any) => l.actor_id).filter(Boolean)))
  const actorName: Record<string, string> = {}
  if (actorIds.length) {
    const { data: au } = await sb.from('users').select('id, name').in('id', actorIds)
    for (const u of au || []) actorName[(u as any).id] = (u as any).name
  }
  const parcLetter = legs.find(l => l.kind === 'parc')?.letter || null
  const remLetter  = legs.find(l => l.kind === 'rem')?.letter  || 'A'
  const relLetterByMission: Record<string, string> = {}
  for (const leg of legs) if (leg.kind === 'rel') relLetterByMission[leg.mission_id] = leg.letter
  const history = (logs || []).map((l: any) => {
    let letter = remLetter
    if (l.mission_id !== root.id) letter = relLetterByMission[l.mission_id] || '?'
    else if (parcLetter && /park|parc|reliv|gardien|zone k/i.test(l.action || '')) letter = parcLetter
    return { letter, at: l.created_at, action: l.action, notes: l.notes, actor: l.actor_id ? (actorName[l.actor_id] || null) : null }
  })

  return NextResponse.json({
    ok: true,
    dossier: {
      ref:        root.mission_number != null ? `#${root.mission_number}` : (root.dossier_number || root.external_id || root.id.slice(0, 8)),
      root_id:    root.id,
      dossier_number: root.dossier_number || null,
      source:     root.source,
      vehicle:    { plate: root.vehicle_plate, brand: root.vehicle_brand, model: root.vehicle_model, vin: root.vehicle_vin },
      client:     { name: root.client_name, phone: root.client_phone },
      legs,
      history,
    },
  })
}

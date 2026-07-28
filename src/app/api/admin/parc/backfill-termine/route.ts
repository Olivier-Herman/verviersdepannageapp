// src/app/api/admin/parc/backfill-termine/route.ts
//
// Backfill unique : rattrape les véhicules qui auraient dû passer "Terminé" dans
// le parc automobile Odoo mais étaient bloqués par l'ancien bug (état gaté sur
// odoo_task_id). Un véhicule est finalisé UNIQUEMENT si TOUTES ses missions sont
// terminales (aucune mission active en cours) — évite de finaliser un véhicule
// repris dans une nouvelle intervention.
//
// GET ?dry=1  → compte seulement (aucune écriture Odoo).
// GET         → écrit state_id=Terminé sur les véhicules concernés (pas déjà Terminé).
// Auth : superadmin (session) OU x-internal-secret === NEXTAUTH_SECRET.
// Olivier 2026-07-28.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { rpcFsm, FLEET_STATES } from '@/lib/odoo-fsm'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const TERMINAL = new Set(['to_invoice', 'invoiced', 'completed'])
const DEAD     = new Set(['cancelled', 'canceled', 'ignored', 'no_charge'])

export async function GET(req: Request) {
  const isInternal = !!process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if ((session?.user as any)?.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const sb = createAdminClient()

  // Toutes les missions ayant un véhicule Odoo lié.
  const { data: rows } = await sb.from('incoming_missions')
    .select('odoo_vehicle_id, status')
    .not('odoo_vehicle_id', 'is', null)
    .limit(20000)

  // Par véhicule : a-t-il au moins une mission terminale ? une mission active ?
  const byVeh = new Map<number, { terminal: boolean; active: boolean }>()
  for (const r of (rows || [])) {
    const id = Number(r.odoo_vehicle_id)
    if (!id) continue
    const st = String(r.status || '').toLowerCase()
    const cur = byVeh.get(id) || { terminal: false, active: false }
    if (TERMINAL.has(st)) cur.terminal = true
    else if (!DEAD.has(st)) cur.active = true   // ni terminal ni mort → active
    byVeh.set(id, cur)
  }

  // Éligibles : au moins une mission terminale ET aucune mission active.
  const eligibleIds = [...byVeh.entries()].filter(([, v]) => v.terminal && !v.active).map(([id]) => id)

  if (eligibleIds.length === 0) {
    return NextResponse.json({ ok: true, dry, vehicles_scanned: byVeh.size, eligible: 0, already_done: 0, to_update: 0, updated: 0 })
  }

  // Lit l'état actuel de ces véhicules dans Odoo (par lots) → ne réécrit que ceux
  // qui ne sont pas déjà "Terminé".
  const CHUNK = 300
  const toUpdate: number[] = []
  let alreadyDone = 0, missing = 0
  for (let i = 0; i < eligibleIds.length; i += CHUNK) {
    const slice = eligibleIds.slice(i, i + CHUNK)
    const veh = await rpcFsm<any[]>('fleet.vehicle', 'read', [slice], { fields: ['id', 'state_id'] }).catch(() => [])
    const seen = new Set<number>()
    for (const v of (veh || [])) {
      seen.add(Number(v.id))
      const stateId = Array.isArray(v.state_id) ? Number(v.state_id[0]) : null
      if (stateId === FLEET_STATES.termine) alreadyDone++
      else toUpdate.push(Number(v.id))
    }
    // véhicules introuvables côté Odoo (supprimés) → ignorés
    missing += slice.filter(id => !seen.has(id)).length
  }

  let updated = 0
  if (!dry && toUpdate.length > 0) {
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const slice = toUpdate.slice(i, i + CHUNK)
      await rpcFsm('fleet.vehicle', 'write', [slice, { state_id: FLEET_STATES.termine }])
      updated += slice.length
    }
  }

  return NextResponse.json({
    ok: true, dry,
    vehicles_scanned: byVeh.size,
    eligible: eligibleIds.length,
    already_done: alreadyDone,
    missing_in_odoo: missing,
    to_update: toUpdate.length,
    updated,
    sample_to_update: toUpdate.slice(0, 20),
  })
}

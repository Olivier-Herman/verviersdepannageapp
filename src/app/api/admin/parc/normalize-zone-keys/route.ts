// src/app/api/admin/parc/normalize-zone-keys/route.ts
//
// POST /api/admin/parc/normalize-zone-keys
// Body : { dry_run?: boolean }
//
// Normalise les parc_zone_key de incoming_missions pour qu ils matchent
// exactement parc_zones.key (sensible a la casse). Bug Olivier 2026-05-21 :
// des vehicules avec parc_zone_key='BOX' (uppercase) ne s affichaient pas
// dans la zone 'Box' (mixed case) du plan visuel.
//
// Algo :
//   1. Liste tous les parc_zones.key (canonique)
//   2. Liste tous les parc_zone_key distincts de incoming_missions
//   3. Pour chaque key non-matchant, trouve la version canonique (case-insensitive)
//   4. Update toutes les missions concernees vers la bonne casse
//
// Acces : admin / superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const dryRun = Boolean(body.dry_run)

  const sb = createAdminClient()

  // 1. Liste les keys canoniques
  const { data: zones, error: zErr } = await sb
    .from('parc_zones')
    .select('key')
  if (zErr) return NextResponse.json({ error: zErr.message }, { status: 500 })
  const canonicalKeys = new Set<string>((zones || []).map((z: any) => z.key))
  const lowerToCanon = new Map<string, string>()
  for (const k of canonicalKeys) lowerToCanon.set(k.toLowerCase(), k)

  // 2. Liste distincts parc_zone_key des missions
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('parc_zone_key')
    .not('parc_zone_key', 'is', null)
  const usedKeys = new Set<string>()
  for (const m of (missions || [])) {
    if (m.parc_zone_key) usedKeys.add(m.parc_zone_key)
  }

  // 3. Pour chaque key non-canonique, trouve le mapping
  const mappings: Array<{ from: string; to: string }> = []
  const unknown:  string[] = []
  for (const k of usedKeys) {
    if (canonicalKeys.has(k)) continue // deja OK
    const canon = lowerToCanon.get(k.toLowerCase())
    if (canon) mappings.push({ from: k, to: canon })
    else unknown.push(k)
  }

  // 4. Compte + update incoming_missions
  const updates: Array<{ table: string; from: string; to: string; count: number }> = []
  for (const map of mappings) {
    const { count } = await sb
      .from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .eq('parc_zone_key', map.from)
    const n = count || 0
    updates.push({ table: 'incoming_missions', from: map.from, to: map.to, count: n })
    if (n > 0 && !dryRun) {
      await sb
        .from('incoming_missions')
        .update({ parc_zone_key: map.to, updated_at: new Date().toISOString() })
        .eq('parc_zone_key', map.from)
    }
  }

  // 4bis. Normalise aussi parc_blocked_slots et parc_slot_groups
  for (const tableName of ['parc_blocked_slots', 'parc_slot_groups'] as const) {
    const { data: rows } = await sb.from(tableName).select('zone_key')
    const tableKeys = new Set<string>()
    for (const r of (rows || [])) {
      if (r.zone_key) tableKeys.add(r.zone_key)
    }
    for (const k of tableKeys) {
      if (canonicalKeys.has(k)) continue
      const canon = lowerToCanon.get(k.toLowerCase())
      if (!canon) {
        if (!unknown.includes(k)) unknown.push(k)
        continue
      }
      const { count } = await sb
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .eq('zone_key', k)
      const n = count || 0
      updates.push({ table: tableName, from: k, to: canon, count: n })
      if (n > 0 && !dryRun) {
        await sb.from(tableName).update({ zone_key: canon }).eq('zone_key', k)
      }
    }
  }

  return NextResponse.json({
    ok:        true,
    dry_run:   dryRun,
    canonical_keys: Array.from(canonicalKeys).sort(),
    used_keys: Array.from(usedKeys).sort(),
    updates,
    unknown,   // keys utilisees mais sans canonique correspondante (a investiguer manuellement)
  })
}

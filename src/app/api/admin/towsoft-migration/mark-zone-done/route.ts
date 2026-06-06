// src/app/api/admin/towsoft-migration/mark-zone-done/route.ts
//
// POST /api/admin/towsoft-migration/mark-zone-done { zone_key, undo?, dry_run? }
//
// Olivier 2026-06-06 : marque une zone comme completement scannee dans le
// workflow migration fourriere. AVANT de marquer la zone done :
//   - Identifie les missions BDD parc_zone_key=X status='parked' qui n ont
//     PAS ete scannees pendant la session de migration (migration_scanned_at
//     IS NULL OU < zone session start)
//   - Les transfere automatiquement vers Transit + migration_pending=true
//     + migration_pending_reason='not_scanned_zone_<X>'
//   - Log dans mission_logs pour audit
//
// Si dry_run=true : retourne juste le nombre de missions qui seraient
// transferees sans rien faire.
// Si undo=true : remet a NULL le timestamp + reverse les transferts pending.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const zoneKey = String(body.zone_key || '').trim()
  const undo    = Boolean(body.undo)
  const dryRun  = Boolean(body.dry_run)

  if (!zoneKey) return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()

  // === UNDO ===
  if (undo) {
    // Reverse : reset timestamp + reverse les transferts pending de cette zone
    const { data: pendingReversed } = await sb
      .from('incoming_missions')
      .select('id, migration_pending_reason')
      .eq('migration_pending', true)
      .eq('migration_pending_reason', `not_scanned_zone_${zoneKey}`)
    if (pendingReversed && pendingReversed.length > 0) {
      // Remet les missions dans leur zone d origine ? Impossible (info perdue).
      // Solution pragmatique : on les remet en zone X + retire le pending.
      // L operateur devra re-scanner si necessaire.
      await sb.from('incoming_missions').update({
        parc_zone_key:           zoneKey,
        migration_pending:       false,
        migration_pending_reason: null,
        updated_at:              new Date().toISOString(),
      }).eq('migration_pending', true).eq('migration_pending_reason', `not_scanned_zone_${zoneKey}`)
    }
    await sb.from('parc_zones').update({
      migration_completed_at: null,
      migration_completed_by: null,
    }).eq('key', zoneKey)
    return NextResponse.json({ ok: true, action: 'undone', reversed_pending: pendingReversed?.length || 0 })
  }

  // === MARK DONE — Identifier les missions non scannees ===
  // Les missions de la zone X qui n'ont PAS migration_scanned_at OU dont
  // migration_scanned_zone != X. On considere comme "scannees pour cette zone"
  // uniquement celles avec migration_scanned_zone=zoneKey.
  const { data: notScanned } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_vin, parc_zone_key, source, external_id, migration_scanned_zone, migration_scanned_at')
    .eq('parc_zone_key', zoneKey)
    .eq('status', 'parked')
    .or(`migration_scanned_at.is.null,migration_scanned_zone.neq.${zoneKey}`)

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      zone_key: zoneKey,
      missions_to_transfer: notScanned?.length || 0,
      sample: (notScanned || []).slice(0, 10).map(m => ({
        mission_number: m.mission_number,
        plate:          m.vehicle_plate,
        source:         m.source,
        external_id:    m.external_id,
      })),
    })
  }

  // === TRANSFERT VERS TRANSIT ===
  let transferred = 0
  if (notScanned && notScanned.length > 0) {
    const ids = notScanned.map(m => m.id)
    const { error: trErr } = await sb
      .from('incoming_missions')
      .update({
        parc_zone_key:            'Transit',
        parc_row_number:          null,
        parc_slot_index:          null,
        migration_pending:        true,
        migration_pending_reason: `not_scanned_zone_${zoneKey}`,
        updated_at:               new Date().toISOString(),
      })
      .in('id', ids)
    if (trErr) {
      return NextResponse.json({ error: `Transfert KO : ${trErr.message}`, transferred }, { status: 500 })
    }
    transferred = ids.length

    // Log audit pour chaque transfert (batch insert)
    await sb.from('mission_logs').insert(
      notScanned.map(m => ({
        mission_id: m.id,
        action:     'migration_transferred_to_transit',
        notes:      `Auto-transfert depuis zone ${zoneKey} vers Transit (pas scanne pendant la migration de ${zoneKey})`,
        actor_id:   actor?.id || null,
        metadata:   {
          from_zone:   zoneKey,
          to_zone:     'Transit',
          reason:      `not_scanned_zone_${zoneKey}`,
          prev_source: m.source,
        },
      }))
    ).then(() => {}, e => console.warn('[mark-zone-done] log batch KO:', e?.message))
  }

  // === MARK ZONE COMPLETED ===
  const { data, error } = await sb
    .from('parc_zones')
    .update({
      migration_completed_at: new Date().toISOString(),
      migration_completed_by: actor?.id || null,
    })
    .eq('key', zoneKey)
    .select('key, migration_completed_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: `Zone ${zoneKey} introuvable`, transferred }, { status: 404 })

  return NextResponse.json({
    ok: true,
    zone_key: data.key,
    migration_completed_at: data.migration_completed_at,
    action: 'completed',
    transferred_to_transit: transferred,
    message: transferred > 0
      ? `Zone ${zoneKey} marquée terminée. ${transferred} véhicule(s) BDD non scannés transférés vers Transit pour traitement humain.`
      : `Zone ${zoneKey} marquée terminée. Aucun véhicule à transférer.`,
  })
}

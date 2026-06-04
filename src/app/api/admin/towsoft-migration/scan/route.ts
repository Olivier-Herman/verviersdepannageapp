// src/app/api/admin/towsoft-migration/scan/route.ts
//
// POST /api/admin/towsoft-migration/scan
// Body: { raw_input: string, zone: string, force_rescan?: boolean }
//
// Traite un scan terrain :
//   - Parse l input (QR /qr/mission, /v/, towsoft num direct, ou plaque/VIN)
//   - Match dans towsoft_migration_source
//   - Marque flag_scanned + scanned_zone + scanned_at
//   - Retourne le statut (deja scanne ailleurs / nouveau / fantome inverse)
//
// Le worker Phase 4 (cron) prendra le relais pour creer la mission VD Soft.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { normalizePlate }   from '@/lib/plate'

export const dynamic = 'force-dynamic'

interface ScanBody {
  raw_input:    string
  zone:         string
  force_rescan?: boolean
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as ScanBody
  const raw  = String(body.raw_input || '').trim()
  const zone = String(body.zone || '').trim()
  const forceRescan = Boolean(body.force_rescan)

  if (!raw)  return NextResponse.json({ error: 'raw_input requis' }, { status: 400 })
  if (!zone) return NextResponse.json({ error: 'zone requise' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Parse l input pour determiner le format
  const parsed = parseScanInput(raw)

  // 2. Match dans towsoft_migration_source
  let match: any = null

  if (parsed.towsoftNum) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('towsoft_num', parsed.towsoftNum)
      .maybeSingle()
    match = data
  }

  if (!match && parsed.vin) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('vin', parsed.vin)
      .maybeSingle()
    match = data
  }

  if (!match && parsed.plate) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('plate', parsed.plate)
      .maybeSingle()
    match = data
  }

  // 3a. Pas de match -> fantome inverse (log dans orphan_scans pour suivi)
  if (!match) {
    const { data: orphan } = await sb
      .from('orphan_scans')
      .insert({
        raw_input:     raw,
        parsed_format: parsed.format,
        plate:         parsed.plate,
        vin:           parsed.vin,
        zone,
        scanned_by:    user.id,
        scanned_at:    new Date().toISOString(),
      })
      .select('id')
      .single()

    return NextResponse.json({
      ok: false,
      reason: 'not_in_towsoft',
      message: 'Vehicule absent de TowSoft : a creer manuellement depuis PoliceClient OU verifier dans Odoo helpdesk. Logge dans la liste des fantomes inverses.',
      parsed,
      orphan_id: orphan?.id || null,
    })
  }

  // 3b. Deja scanne -> demander confirmation
  if (match.flag_scanned && !forceRescan && match.scanned_zone !== zone) {
    return NextResponse.json({
      ok:    false,
      reason: 'already_scanned',
      message: `Deja scanne en zone ${match.scanned_zone} le ${match.scanned_at}. Confirmer le changement vers ${zone} ?`,
      match,
    }, { status: 409 })
  }

  // 3c. Deja scanne meme zone (re-scan accidentel) -> succes idempotent
  if (match.flag_scanned && match.scanned_zone === zone) {
    return NextResponse.json({
      ok: true,
      reason: 'already_in_zone',
      message: `Deja scanne en ${zone} (re-scan idempotent)`,
      match,
    })
  }

  // 4. Marque flag_scanned + scanned_zone + scanned_at + qr_format
  const updates: Record<string, any> = {
    flag_scanned:     true,
    scanned_at:       new Date().toISOString(),
    scanned_zone:     zone,
    scanned_by_user:  user.id,
    scanned_qr_format: parsed.format,
    updated_at:       new Date().toISOString(),
  }
  // Si re-scan avec force_rescan, reset import pour que le worker re-cree avec la nouvelle zone
  if (forceRescan && match.flag_scanned) {
    updates.imported_at = null
    updates.import_attempts = 0
    updates.import_error = null
    updates.next_import_retry_at = new Date().toISOString()  // retry asap
  }

  const { error: upErr } = await sb
    .from('towsoft_migration_source')
    .update(updates)
    .eq('id', match.id)

  if (upErr) {
    console.error('[towsoft-migration/scan] update echec:', upErr.message)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    reason: forceRescan ? 'rescanned_zone_changed' : 'scanned',
    message: `Scanne en ${zone} : ${match.plate || match.towsoft_num}`,
    match: { ...match, scanned_zone: zone, flag_scanned: true },
    parsed,
  })
}

// ───────────────────────────────────────────────────────────────────
// Parser scan input
// ───────────────────────────────────────────────────────────────────

interface ParsedScan {
  format:      'towsoft_url' | 'towsoft_num' | 'qr_mission' | 'v_legacy' | 'plate' | 'vin' | 'unknown'
  towsoftNum:  string | null
  missionNum:  string | null
  ticketId:    string | null
  plate:       string | null
  vin:         string | null
  raw:         string
}

function parseScanInput(input: string): ParsedScan {
  const out: ParsedScan = {
    format: 'unknown',
    towsoftNum: null, missionNum: null, ticketId: null, plate: null, vin: null,
    raw: input,
  }
  const s = input.trim()

  // URL TowSoft appel.php?num=XXX
  const towsoftUrl = s.match(/towsoft\.ca\/appel\.php\?num=(\d+)/i)
  if (towsoftUrl) {
    out.format = 'towsoft_url'
    out.towsoftNum = towsoftUrl[1]
    return out
  }

  // URL /qr/mission/[id]
  const qrMission = s.match(/\/qr\/mission\/([0-9a-f-]+)/i)
  if (qrMission) {
    out.format = 'qr_mission'
    out.missionNum = qrMission[1]
    return out
  }

  // URL /v/[id]
  const vLegacy = s.match(/\/v\/(\d+)/i)
  if (vLegacy) {
    out.format = 'v_legacy'
    out.ticketId = vLegacy[1]
    return out
  }

  // N° TowSoft direct (4-7 chiffres)
  if (/^\d{4,7}$/.test(s)) {
    out.format = 'towsoft_num'
    out.towsoftNum = s
    return out
  }

  // VIN (17 chars alphanumeriques sauf I O Q)
  const vinClean = s.replace(/[-.\s]/g, '').toUpperCase()
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vinClean)) {
    out.format = 'vin'
    out.vin = vinClean
    return out
  }

  // Plaque BE (normalisee)
  const plateClean = normalizePlate(s)
  if (plateClean.length >= 4 && plateClean.length <= 10) {
    out.format = 'plate'
    out.plate = plateClean
    return out
  }

  return out
}

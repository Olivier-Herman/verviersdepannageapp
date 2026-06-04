// src/lib/towsoft-migration/parse-scan.ts
//
// Olivier 2026-06-04 : helper de parsing des inputs de scan migration.
// Reconnait 7 formats :
//   - URL TowSoft       : towsoft.ca/appel.php?num=XXX
//   - URL Odoo fleet    : odoo.com/odoo/fleet/3243 ou /web#id=3243&model=fleet.vehicle
//   - URL VD Soft       : /qr/mission/[id]
//   - URL Verviers-QR   : /v/[ticketId]
//   - Numero TowSoft    : "12345"
//   - VIN 17 chars
//   - Plaque BE
//
// Utilise par :
//   - /api/admin/towsoft-migration/scan
//   - /api/admin/towsoft-migration/orphans/retry (re-parse raw_input des
//     orphans crees avant l ajout d un nouveau format)

import { normalizePlate } from '@/lib/plate'

export interface ParsedScan {
  format:        'towsoft_url' | 'towsoft_num' | 'qr_mission' | 'v_legacy' | 'odoo_fleet' | 'plate' | 'vin' | 'unknown'
  towsoftNum:    string | null
  missionNum:    string | null
  ticketId:      string | null
  odooVehicleId: string | null
  plate:         string | null
  vin:           string | null
  raw:           string
}

export function parseScanInput(input: string): ParsedScan {
  const out: ParsedScan = {
    format: 'unknown',
    towsoftNum: null, missionNum: null, ticketId: null, odooVehicleId: null, plate: null, vin: null,
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

  // URL Odoo backend fleet.vehicle
  const odooFleetWithId = s.match(/odoo\.com\/odoo\/fleet\/(\d+)/i) || s.match(/[?&]id=(\d+)[^&]*&model=fleet\.vehicle/i)
  if (odooFleetWithId) {
    out.format = 'odoo_fleet'
    out.odooVehicleId = odooFleetWithId[1]
    return out
  }
  if (/odoo\.com\/odoo\/fleet\/?$/i.test(s)) {
    out.format = 'odoo_fleet'
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

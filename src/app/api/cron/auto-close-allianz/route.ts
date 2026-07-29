// src/app/api/cron/auto-close-allianz/route.ts
//
// Auto-clôture Allianz/Hexalite (cron horaire). Rejoue EXACTEMENT le bouton
// « Tout clôturer » du module Clôture Allianz : rafraîchit la liste (missions
// Hexalite « à clôturer » rapprochées d'une fiche VD Soft to_invoice), puis
// clôture chaque ligne (mêmes endpoints /list, /km, /close). Idempotent : une
// fois clôturée, la mission sort de la liste. Olivier 2026-07-29.
//
// Si le token Hexalite (OTP) est expiré → la liste renvoie needsAuth → on saute
// la passe (reconnexion manuelle requise). Best-effort, non bloquant.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { ALLIANZ_PROVIDED_SERVICE } from '@/lib/allianz/closure'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const BATCH = 40            // borne par passe (chaque clôture = quelques appels Hexalite)
const CLOSE_DELAY_MIN = 60  // fenêtre de vérif : on n'auto-clôture qu'à fin de mission + 60 min

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Kill-switch : DISABLE_AUTO_CLOSE_ALLIANZ=true sur Vercel pour mettre en pause.
  if (process.env.DISABLE_AUTO_CLOSE_ALLIANZ === 'true') {
    return NextResponse.json({ ok: true, disabled: true })
  }
  const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  const secret  = process.env.NEXTAUTH_SECRET || ''
  const sb = createAdminClient()

  const summary: any = { at: new Date().toISOString() }
  const details: any[] = []

  // 1) Liste des missions à clôturer (déjà filtrée vdsoft to_invoice).
  let rows: any[] = []
  try {
    const r = await fetch(`${baseUrl}/api/facturation/allianz/list`, { headers: { 'x-internal-secret': secret }, cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.needsAuth) {
      summary.ok = false
      summary.skipped = j?.needsAuth ? 'token Hexalite expiré (reconnexion manuelle requise)' : `list HTTP ${r.status}`
      await sb.from('app_settings').upsert({ key: 'auto_close_allianz_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
      return NextResponse.json({ ok: false, ...summary })
    }
    rows = Array.isArray(j?.rows) ? j.rows : []
  } catch (e: any) {
    summary.ok = false; summary.error = String(e?.message || e)
    await sb.from('app_settings').upsert({ key: 'auto_close_allianz_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
    return NextResponse.json({ ok: false, ...summary })
  }

  // completed_at (fin de mission) des fiches VD Soft liées → gate +60 min.
  const vdIds = rows.map(r => r.vdsoft?.id).filter(Boolean)
  const compMap = new Map<string, string | null>()
  if (vdIds.length) {
    const { data } = await sb.from('incoming_missions').select('id, completed_at').in('id', vdIds)
    for (const m of (data || [])) compMap.set(m.id, m.completed_at)
  }
  const nowMs = Date.now()

  let closed = 0, failed = 0, skipped = 0, waiting = 0
  for (const row of rows.slice(0, BATCH)) {
    const vd = row.vdsoft
    if (!vd?.id) { skipped++; continue }
    const ref = vd.mission_number ?? vd.external_id ?? row.assignmentNumber
    // Fenêtre de vérif : on ne clôture qu'à fin de mission + 60 min.
    const compMs = compMap.get(vd.id) ? new Date(compMap.get(vd.id)!).getTime() : null
    if (compMs == null || compMs > nowMs - CLOSE_DELAY_MIN * 60_000) {
      waiting++; details.push({ mission: ref, outcome: 'waiting' }); continue
    }
    try {
      // km total de la mission VD Soft (comme le bouton).
      let km: number | undefined
      try {
        const kr = await fetch(`${baseUrl}/api/missions/${vd.id}/km`, { headers: { 'x-internal-secret': secret }, cache: 'no-store' })
        const kj = await kr.json().catch(() => ({}))
        km = typeof kj?.total_km === 'number' ? kj.total_km : undefined
      } catch { /* km indispo → close refusera si pas de towsoftNum */ }

      const providedService = ALLIANZ_PROVIDED_SERVICE[String(vd.mission_type || '').toLowerCase()] || 'T'
      const body: any = {
        assignmentId:   row.assignmentId,
        caseId:         row.caseId,
        providedService,
        receivedIso:    row.dispatchTime || vd.received_at,
        tariffZip:      row.breakdown?.zipCode || null,
        tariffLat:      row.breakdown?.latitude || null,
        tariffLng:      row.breakdown?.longitude || null,
        distanceKm:     km,
        vdsoftMissionId: vd.id,
      }
      if (providedService === 'T' && vd.destination_address) {
        body.destination = {
          name: vd.destination_address, countryCode: 'BE', countryName: 'Belgique',
          latitude:  vd.destination_lat ?? undefined,
          longitude: vd.destination_lng ?? undefined,
        }
      }
      const cr = await fetch(`${baseUrl}/api/facturation/allianz/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify(body),
      })
      const cj = await cr.json().catch(() => ({}))
      if (cj?.ok) { closed++; details.push({ mission: ref, outcome: 'closed' }) }
      else { failed++; details.push({ mission: ref, outcome: 'failed', reason: cj?.error || `HTTP ${cr.status}` }) }
    } catch (e: any) {
      failed++; details.push({ mission: ref, outcome: 'failed', reason: `fetch: ${String(e?.message || e)}` })
    }
  }

  Object.assign(summary, { ok: true, delay_min: CLOSE_DELAY_MIN, scanned: rows.length, closed, failed, waiting, skipped, details: details.slice(0, 60) })
  await sb.from('app_settings').upsert({ key: 'auto_close_allianz_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
  console.log('[auto-close-allianz]', JSON.stringify({ scanned: rows.length, closed, failed, waiting, skipped }))
  return NextResponse.json(summary)
}

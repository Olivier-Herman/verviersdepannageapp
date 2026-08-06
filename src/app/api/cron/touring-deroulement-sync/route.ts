// src/app/api/cron/touring-deroulement-sync/route.ts
//
// Sync quotidien du « Déroulement Touring » depuis COMEX BKO : re-lit les accords
// récents (facturés) + les dossiers InWait (en cours), et upsert dans
// touring_deroulement (idempotent). Le backfill historique 2025/2026 a été fait
// à part. Olivier 2026-08-06.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import {
  getBkoAccounts, loginComexBko, listBkoAccords,
  listBkoDeroulementForAccord, listBkoDeroulementInWait, type BkoDossierDetail,
} from '@/lib/touring/comex-bko'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Mise en place de l'automatisation Touring → séparation avant/après pour comparer.
const CUTOFF = Date.UTC(2026, 7, 6, 0, 0, 0)   // 06/08/2026 (Brussels ~= ce jour)
// Fenêtre de re-sync des accords (par date de création). Les anciens ne changent plus.
const ACCORD_WINDOW_DAYS = 120

// Heures COMEX = wall-clock Europe/Brussels → ISO UTC correct quelle que soit la TZ serveur.
function brusselsOffsetMin(instant: number): number {
  const d = new Date(instant)
  const b = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((b.getTime() - u.getTime()) / 60000)
}
function parseBx(s?: string | null): number | null {
  const m = (s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const naiveUtc = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6])
  return naiveUtc - brusselsOffsetMin(naiveUtc) * 60000   // instant UTC réel
}
const isoOf = (t: number | null) => t == null ? null : new Date(t).toISOString()
const dmin = (a: number | null, b: number | null) => (a != null && b != null) ? Math.round((b - a) / 60000) : null

function toRow(d: BkoDossierDetail, account: string, statut: string) {
  const as = parseBx(d.assignDate), ac = parseBx(d.acceptDate), or = parseBx(d.onRoadDate),
        os = parseBx(d.onSpotDate), en = parseBx(d.endDate), fd = parseBx(d.fileDate)
  const phaseRef = ac ?? fd
  return {
    account, dossier: d.dossier, seq: d.seq || '0', accord: d.accord || null, statut_fact: statut,
    file_date: isoOf(fd), action: d.action, order_num: d.orderNum,
    assign_at: isoOf(as), accept_at: isoOf(ac), onroad_at: isoOf(or), onspot_at: isoOf(os), end_at: isoOf(en),
    arc_code: d.arcCode, vin: d.vin, plate: d.plate, cod_trajet: d.codTrajet,
    prestataire: d.prestataire, brand: d.brand, model: d.model, agent: d.agent,
    delai_assign_accept: dmin(as, ac), delai_accept_onroad: dmin(ac, or),
    delai_assign_onspot: dmin(as, os), delai_accept_end: dmin(ac, en),
    auto_phase: phaseRef == null ? null : (phaseRef < CUTOFF ? 'avant' : 'apres'),
  }
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const floor = Date.now() - ACCORD_WINDOW_DAYS * 86400_000
  const summary: any = { at: new Date().toISOString(), accounts: {} }
  const byKey = new Map<string, any>()

  for (const acct of getBkoAccounts()) {
    const st: any = { accords: 0, facture: 0, inWait: 0, error: null }
    try {
      const cookie = await loginComexBko(acct)
      const accords = await listBkoAccords(cookie)
      const recent = accords.filter(a => {
        const m = (a.creationDate || '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
        return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) >= floor : true
      })
      st.accords = recent.length
      for (const a of recent) {
        try {
          const rows = await listBkoDeroulementForAccord(cookie, a.numAccord)
          for (const d of rows) { const r = toRow(d, acct.label, 'facturee'); byKey.set(`${r.account}|${r.dossier}|${r.seq}`, r); st.facture++ }
        } catch { /* accord KO → skip */ }
      }
      try {
        const iw = await listBkoDeroulementInWait(cookie)
        for (const d of iw) { const k = `${acct.label}|${d.dossier}|${d.seq || '0'}`; if (!byKey.has(k)) { byKey.set(k, toRow(d, acct.label, 'inWait')); st.inWait++ } }
      } catch { /* InWait KO */ }
    } catch (e: any) { st.error = e?.message || 'échec' }
    summary.accounts[acct.label] = st
  }

  const rows = [...byKey.values()]
  let upserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('touring_deroulement').upsert(rows.slice(i, i + 500), { onConflict: 'account,dossier,seq' })
    if (error) { summary.upsertError = error.message; break }
    upserted += Math.min(500, rows.length - i)
  }
  summary.upserted = upserted
  console.log('[cron touring-deroulement]', JSON.stringify({ upserted, accounts: summary.accounts }))
  return NextResponse.json(summary)
}

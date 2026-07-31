// src/app/api/admin/facturation-delay/route.ts
//
// Diagnostic du « délai moyen à facturer » (completed_at → invoiced_at) sur la
// même fenêtre que le tableau de bord. Renvoie moyenne, MÉDIANE, tranches de
// distribution, top des plus lents et détail par source → pour comprendre ce
// qui gonfle la moyenne. Superadmin. Olivier 2026-07-31.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration = 30

const PERIOD_DAYS = 7
const TOURING_SOURCES = ['touring', 'tgr_touring']

function bxlDayStartISO(daysAgo = 0): string {
  const now = new Date()
  const bxl = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = bxl.getTime() - utc.getTime()
  const midnight = new Date(bxl); midnight.setHours(0, 0, 0, 0)
  midnight.setDate(midnight.getDate() - daysAgo)
  return new Date(midnight.getTime() - offsetMs).toISOString()
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sp = new URL(req.url).searchParams
  const days = parseInt(sp.get('days') || String(PERIOD_DAYS))
  // `since` (ISO ou YYYY-MM-DD) prioritaire sur `days` — ex: ?since=2026-07-28
  const sinceParam = sp.get('since')
  const sb = createAdminClient()
  const startPeriod = sinceParam
    ? new Date(sinceParam.length <= 10 ? `${sinceParam}T00:00:00+02:00` : sinceParam).toISOString()
    : bxlDayStartISO(days)

  // Ensemble COMEX BKO (mêmes règles que le tableau de bord).
  const comexBkoIds = new Set<string>()
  const { data: bkoRows } = await sb.from('touring_comex_dossiers').select('mission_id, mission_ids')
  for (const r of (bkoRows || [])) {
    if (r.mission_id) comexBkoIds.add(r.mission_id as string)
    if (Array.isArray(r.mission_ids)) for (const id of r.mission_ids) if (id) comexBkoIds.add(id as string)
  }

  const rows: any[] = []
  for (let page = 0; page < 20; page++) {
    const { data: chunk } = await sb.from('incoming_missions')
      .select('id, mission_number, source, mission_type, completed_at, invoiced_at, no_charge_at')
      .eq('status', 'completed')
      .or(`invoiced_at.gte.${startPeriod},no_charge_at.gte.${startPeriod}`)
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (!chunk || !chunk.length) break
    rows.push(...chunk)
    if (chunk.length < 1000) break
  }

  const H = 3600e3
  const items: any[] = []
  for (const m of rows) {
    const isTouringHorsBko = TOURING_SOURCES.includes(m.source) && !comexBkoIds.has(m.id)
    const end = m.invoiced_at || m.no_charge_at
    if (!end || !m.completed_at) continue
    const ms = Date.parse(end) - Date.parse(m.completed_at)
    if (ms < 0) continue
    items.push({
      id: m.id, n: m.mission_number, source: m.source, type: m.mission_type,
      completed_at: m.completed_at, invoiced_at: m.invoiced_at, no_charge_at: m.no_charge_at,
      h: Math.round(ms / H * 10) / 10, excluded: isTouringHorsBko,
    })
  }

  const kept = items.filter(i => !i.excluded)
  const stat = (arr: any[]) => {
    if (!arr.length) return { n: 0, meanH: null, medianH: null }
    const hs = arr.map(i => i.h).sort((a, b) => a - b)
    const mean = hs.reduce((s, x) => s + x, 0) / hs.length
    const mid = hs.length % 2 ? hs[(hs.length - 1) / 2] : (hs[hs.length / 2 - 1] + hs[hs.length / 2]) / 2
    return { n: hs.length, meanH: Math.round(mean * 10) / 10, medianH: Math.round(mid * 10) / 10 }
  }

  const buckets = { '<1h': 0, '1-6h': 0, '6-24h': 0, '1-3j': 0, '3-7j': 0, '>7j': 0 }
  for (const i of kept) {
    const h = i.h
    if (h < 1) buckets['<1h']++
    else if (h < 6) buckets['1-6h']++
    else if (h < 24) buckets['6-24h']++
    else if (h < 72) buckets['1-3j']++
    else if (h < 168) buckets['3-7j']++
    else buckets['>7j']++
  }

  const bySource: Record<string, any> = {}
  for (const src of [...new Set(kept.map(i => i.source || '—'))]) {
    bySource[src] = stat(kept.filter(i => (i.source || '—') === src))
  }

  const slowest = [...kept].sort((a, b) => b.h - a.h).slice(0, 20)
    .map(i => ({ n: i.n, source: i.source, type: i.type, delaiH: i.h, completed_at: i.completed_at, invoiced_at: i.invoiced_at }))

  // Découpage clé : fiches TERMINÉES depuis la borne (vrai flux auto-facturation)
  // vs BACKLOG (terminées avant, facturées seulement maintenant → gros délais
  // de rattrapage qui gonflent la moyenne globale).
  const fresh   = kept.filter(i => i.completed_at >= startPeriod)
  const backlog = kept.filter(i => i.completed_at <  startPeriod)

  return NextResponse.json({
    borneDebut: startPeriod,
    global:  stat(kept),
    cohortes: {
      termineesDepuisBorne: stat(fresh),   // vrai flux auto-facturation
      backlogRattrape:      stat(backlog), // vieilles fiches facturées maintenant
    },
    tranches: buckets,
    parSource: Object.fromEntries(Object.entries(bySource).sort((a: any, b: any) => (b[1].n) - (a[1].n))),
    top20PlusLents: slowest,
    exclusTouringHorsBko: items.filter(i => i.excluded).length,
  })
}

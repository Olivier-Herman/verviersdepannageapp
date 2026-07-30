// src/app/api/tableau-bord/route.ts
//
// KPIs du mur d'écran ops (page publique /tableau-bord protégée par PIN).
// Route PUBLIQUE (hors matcher middleware) → on valide le PIN nous-mêmes.
// Données via service_role (no-store). Olivier 2026-07-30.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 30

const PIN = process.env.DASHBOARD_PIN || '071000'

// Instant UTC (ISO) de minuit à Bruxelles il y a `daysAgo` jours (gère l'heure d'été).
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
  const pin = req.headers.get('x-dashboard-pin') || new URL(req.url).searchParams.get('pin') || ''
  if (pin !== PIN) return NextResponse.json({ error: 'PIN invalide' }, { status: 401 })

  const sb = createAdminClient()

  // 1) Missions ouvertes (compteurs ops). Un seul select, bucketing en JS.
  const OPEN = ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering', 'parked', 'to_invoice']
  const { data: open } = await sb.from('incoming_missions')
    .select('status, parc_zone_key')
    .in('status', OPEN)
    .is('archived_at', null)
    .limit(20000)
  const cnt = (fn: (m: any) => boolean) => (open || []).filter(fn).length

  const enCommande = cnt(m => m.status === 'new')
  const enAttente  = cnt(m => ['dispatching', 'assigned', 'accepted'].includes(m.status))
  const enCours    = cnt(m => ['in_progress', 'delivering'].includes(m.status))
  const aFacturer  = cnt(m => m.status === 'to_invoice')
  const enParc     = cnt(m => m.status === 'parked' && !!m.parc_zone_key)
  const zoneKK1    = (z: any) => { const s = String(z || '').trim().toUpperCase(); return s === 'K' || s === 'K1' }
  const enParcKK1  = cnt(m => m.status === 'parked' && zoneKK1(m.parc_zone_key))

  // 2) Fiches clôturées : fenêtre 30 j (répartition + durée) + aujourd'hui.
  const PERIOD_DAYS = 7
  const startPeriod = bxlDayStartISO(PERIOD_DAYS)
  const startToday  = bxlDayStartISO(0)
  // PostgREST plafonne à 1000 lignes/requête → pagination (order stable par id)
  // pour ne rien tronquer (répartition + durée + total).
  const rows: any[] = []
  for (let page = 0; page < 15; page++) {
    const { data: chunk } = await sb.from('incoming_missions')
      .select('invoiced_by, invoice_method, completed_at, invoiced_at, no_charge_at')
      .eq('status', 'completed')
      .or(`invoiced_at.gte.${startPeriod},no_charge_at.gte.${startPeriod}`)
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (!chunk || !chunk.length) break
    rows.push(...chunk)
    if (chunk.length < 1000) break
  }
  const finalAt = (m: any) => m.invoiced_at || m.no_charge_at || null

  // Clôturés aujourd'hui.
  const cloturesJour = rows.filter(m => { const f = finalAt(m); return f && f >= startToday }).length

  // Durée moyenne « À facturer » → « Terminé » = invoiced_at − completed_at (30 j).
  let durSum = 0, durN = 0
  for (const m of rows) {
    const end = m.invoiced_at || m.no_charge_at
    if (end && m.completed_at) {
      const d = Date.parse(end) - Date.parse(m.completed_at)
      if (d >= 0) { durSum += d; durN++ }
    }
  }
  const dureeMoyMin = durN ? Math.round(durSum / durN / 60000) : null   // minutes

  // Répartition facturation par user (30 j). invoiced_by null = Système (auto).
  const byUser = new Map<string, number>()
  for (const m of rows) {
    const k = m.invoiced_by || '__system__'
    byUser.set(k, (byUser.get(k) || 0) + 1)
  }
  const userIds = [...byUser.keys()].filter(k => k !== '__system__')
  const names = new Map<string, string>()
  if (userIds.length) {
    const { data: us } = await sb.from('users').select('id, name').in('id', userIds)
    for (const u of (us || [])) names.set(u.id, u.name || '—')
  }
  const totalFactu = rows.length || 1
  const facturationParUser = [...byUser.entries()]
    .map(([k, n]) => ({
      user: k === '__system__' ? 'Système (auto)' : (names.get(k) || '—'),
      count: n,
      pct: Math.round((n / totalFactu) * 100),
      system: k === '__system__',
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    ops: { enCommande, enAttente, enCours, aFacturer, enParc, enParcKK1, cloturesJour },
    facturation: {
      periodeJours: PERIOD_DAYS,
      total: rows.length,
      dureeMoyMin,
      parUser: facturationParUser,
    },
  })
}

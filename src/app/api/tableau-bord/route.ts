// src/app/api/tableau-bord/route.ts
//
// KPIs du mur d'écran ops (page publique /tableau-bord protégée par PIN).
// Route PUBLIQUE (hors matcher middleware) → on valide le PIN nous-mêmes.
// Compteurs ALIGNÉS sur les onglets du module dispatch (mêmes filtres :
// placeholders exclus, parse_confidence≥0.3, non archivées, futures +12h exclues,
// VHU exclu). Données via service_role (no-store). Olivier 2026-07-30.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 30

const PIN = process.env.DASHBOARD_PIN || '071000'
const VHU_SOURCE = 'garage_j7772c'
const PERIOD_DAYS = 7

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

// Nombre de clôtures Allianz prêtes (Hexalite TO_ASSIGN ∩ VD Soft to_invoice).
// Live Hexalite → CACHE 5 min (app_settings) pour ne pas taper l'API à chaque poll.
async function getAllianzClotureCount(sb: any): Promise<number | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'allianz_cloture_cache').maybeSingle()
  let cache: any = null
  try { cache = data?.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null } catch {}
  if (cache?.at && Date.now() - Date.parse(cache.at) < 5 * 60 * 1000) return cache.count ?? null
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
    const r = await fetch(`${baseUrl}/api/facturation/allianz/list`, {
      cache: 'no-store',
      headers: { 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json().catch(() => ({}))
    const count = typeof j?.count === 'number' ? j.count : (cache?.count ?? null)
    await sb.from('app_settings').upsert({ key: 'allianz_cloture_cache', value: { count, at: new Date().toISOString() } }, { onConflict: 'key' }).then(() => {}, () => {})
    return count
  } catch { return cache?.count ?? null }
}

export async function GET(req: Request) {
  const pin = req.headers.get('x-dashboard-pin') || new URL(req.url).searchParams.get('pin') || ''
  if (pin !== PIN) return NextResponse.json({ error: 'PIN invalide' }, { status: 401 })

  const sb = createAdminClient()
  const RDV_THRESHOLD = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  const startToday    = bxlDayStartISO(0)
  const startPeriod   = bxlDayStartISO(PERIOD_DAYS)

  // Base identique au module dispatch (src/app/api/missions/list countBy).
  const countBy = (apply: (q: any) => any) => {
    const q = sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .not('external_id', 'like', 'PROCESSING_%')
      .not('external_id', 'like', 'UNKNOWN_SENDER_%')
      .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
      .is('archived_at', null)
    return apply(q)
  }
  const exclFuture = (q: any) => q.or(`intervention_date.is.null,intervention_date.lte.${RDV_THRESHOLD}`)

  const [
    cCommande, cAttente, cAssign, cCours, cFacturer,
    cParc, cTerminees, cFacturees,
  ] = await Promise.all([
    countBy(q => q.eq('status', 'new').neq('source', VHU_SOURCE)),                       // En commande
    countBy(q => exclFuture(q.eq('status', 'dispatching')).neq('source', VHU_SOURCE)),   // En attente
    countBy(q => exclFuture(q.in('status', ['assigned', 'accepted']))),                  // Assignées
    countBy(q => exclFuture(q.in('status', ['in_progress', 'delivering']))),             // En cours
    countBy(q => q.eq('status', 'to_invoice')),                                          // À facturer
    // Parc physique (aligné fourrière : parked + zone).
    sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .eq('status', 'parked').not('parc_zone_key', 'is', null),
    // Du jour : terminées (completed_at aujourd'hui) / facturées (invoiced_at aujourd'hui).
    sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .gte('completed_at', startToday).not('status', 'in', '(cancelled,ignored,parse_error)'),
    sb.from('incoming_missions').select('*', { count: 'exact', head: true })
      .gte('invoiced_at', startToday),
  ])

  // « À relivrer » (= onglet dispatch À Relivrer, K+K1) : parked en zone K/K1
  // (filtres de base) MOINS les parents ayant déjà une REL enfant active.
  const { data: kk1Rows } = await sb.from('incoming_missions').select('id')
    .eq('status', 'parked').in('parc_zone_key', ['K', 'K1'])
    .not('external_id', 'like', 'PROCESSING_%').not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    .is('archived_at', null)
  const kk1Ids = (kk1Rows || []).map(r => r.id)
  let aRelivrer = kk1Ids.length
  if (kk1Ids.length) {
    const { data: kids } = await sb.from('incoming_missions').select('parent_mission_id')
      .in('parent_mission_id', kk1Ids).not('status', 'in', '("cancelled","ignored")')
    const withChild = new Set((kids || []).map(k => k.parent_mission_id).filter(Boolean))
    aRelivrer = kk1Ids.filter(id => !withChild.has(id)).length
  }

  // Durée moyenne « À facturer » → « Terminé » = invoiced_at − completed_at (fenêtre,
  // paginé car PostgREST plafonne à 1000 lignes).
  let durSum = 0, durN = 0
  for (let page = 0; page < 15; page++) {
    const { data: chunk } = await sb.from('incoming_missions')
      .select('completed_at, invoiced_at, no_charge_at')
      .eq('status', 'completed')
      .or(`invoiced_at.gte.${startPeriod},no_charge_at.gte.${startPeriod}`)
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (!chunk || !chunk.length) break
    for (const m of chunk) {
      const end = m.invoiced_at || m.no_charge_at
      if (end && m.completed_at) {
        const d = Date.parse(end) - Date.parse(m.completed_at)
        if (d >= 0) { durSum += d; durN++ }
      }
    }
    if (chunk.length < 1000) break
  }
  const dureeMoyMin = durN ? Math.round(durSum / durN / 60000) : null

  // ── Slide 2 : à facturer PAR SOURCE + ratios Touring/Allianz ───────────────
  const { data: toInvRows } = await sb.from('incoming_missions')
    .select('source').eq('status', 'to_invoice').limit(3000)
  const srcCount = new Map<string, number>()
  for (const r of (toInvRows || [])) { const s = r.source || 'inconnu'; srcCount.set(s, (srcCount.get(s) || 0) + 1) }

  const { data: cat } = await sb.from('mission_source_catalog').select('key, label, display_color_hex')
  const catMap = new Map((cat || []).map((c: any) => [c.key, { label: c.label, hex: c.display_color_hex }]))
  const parSource = [...srcCount.entries()]
    .map(([key, count]) => ({ key, label: (catMap.get(key) as any)?.label || key, hex: (catMap.get(key) as any)?.hex || '#64748b', count }))
    .sort((a, b) => b.count - a.count)

  const touringTotal = (srcCount.get('touring') || 0) + (srcCount.get('tgr_touring') || 0)
  const { count: comexBko } = await sb.from('touring_comex_dossiers')
    .select('*', { count: 'exact', head: true }).eq('in_comex', true).in('verdict', ['ok', 'verify'])
  const allianzTotal = (srcCount.get('allianz') || 0) + (srcCount.get('mondial') || 0)
  const clotureAllianz = await getAllianzClotureCount(sb)

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    ops: {
      enCommande:    cCommande.count  || 0,
      enAttente:     cAttente.count   || 0,
      assignees:     cAssign.count    || 0,
      enCours:       cCours.count     || 0,
      aFacturer:     cFacturer.count  || 0,
      enParc:        cParc.count      || 0,
      aRelivrer,
      termineesJour: cTerminees.count || 0,
      factureesJour: cFacturees.count || 0,
    },
    facturation: { periodeJours: PERIOD_DAYS, dureeMoyMin },
    sources: {
      parSource,
      touring: { bko: comexBko || 0, total: touringTotal },
      allianz: { cloture: clotureAllianz, total: allianzTotal },
    },
  })
}

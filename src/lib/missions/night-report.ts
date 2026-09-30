// src/lib/missions/night-report.ts
//
// Statistiques de la garde de nuit (Olivier 30/09/2026), partagées par la page
// /admin/garde-nuit et le rapport envoyé chaque matin à 10 h. Source : le journal
// market_proposal_events (écrit par lib/missions/market-proposals.ts).
//
// « Annoncé contre réalité » : pour chaque « Je suis déjà en mission », on compare
// ce que le chauffeur a annoncé (« j'en ai pour 30 min ») et ce que l'app avait
// estimé pour terminer ce qu'il avait en cours, avec l'heure à laquelle il a
// RÉELLEMENT terminé (clôture de ses fiches en cours, ou de la fiche créée après
// coup quand il n'en avait pas : appel police…).

import { createAdminClient } from '@/lib/supabase'

export const KIND_LABEL: Record<string, string> = {
  proposed: 'Proposée', called: 'Appel', accepted: 'Acceptée', busy_declared: '« Déjà en mission »',
  eta: 'Estimation', refused: 'Refus confirmé', snoozed: 'Rappel 15 min', reminded: 'Reproposée',
  client_call: 'Appel au client', client_ok: 'Client d’accord', client_ko: 'Client pas d’accord',
  timeout: 'Sans réponse', to_dispatcher: 'Au dispatch', returned_to_first: 'Renvoyée au 1er départ',
  taken_by_other: 'Prise par un autre', assigned_by_dispatch: 'Attribuée par le dispatch', claimed_in_market: 'Prise dans Momo Market',
}

export interface Declaration {
  at: string; driverName: string; missionNumber: number | null; missionId: string | null
  declaredMin: number | null        // « j'en ai pour X min » (sans fiche)
  estimatedFinishMin: number | null // estimation de l'app pour terminer ce qu'il avait en cours
  etaMin: number | null             // arrivée estimée sur la mission proposée
  actualFinishMin: number | null    // fin réelle (clôture) après la déclaration
  announcedMin: number | null       // ce qui sert de référence : annoncé, sinon estimé
  gapMin: number | null             // réel − annoncé (négatif = fini plus tôt qu'annoncé)
  verdict: 'ok' | 'earlier' | 'later' | 'pending'
}

export interface NightStats {
  since: string; until: string; empty: boolean
  kpis: { label: string; value: string; hint?: string }[]
  perDriver: { id: string; name: string; first: number; reserve: number; accepted: number; refused: number; noAnswer: number; snoozed: number; median: number | null }[]
  timeline: { missionId: string; number: number | null; label: string; events: { at: string; kind: string; label: string; driver: string | null; extra: string }[] }[]
  declarations: Declaration[]
}

const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
export const dur = (s: number | null) => s == null ? '—' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
const minsBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
const TOLERANCE_MIN = 15   // écart toléré entre annoncé et réel

export async function loadNightStats(since: string, until: string): Promise<NightStats> {
  const sb = createAdminClient()
  const [{ data: events }, { data: props }] = await Promise.all([
    sb.from('market_proposal_events').select('proposal_id, mission_id, driver_id, kind, data, created_at').gte('created_at', since).lt('created_at', until).order('created_at').limit(5000),
    sb.from('market_proposals').select('id, mission_id, driver_id, step, status').eq('is_test', false).gte('created_at', since).lt('created_at', until).limit(5000),
  ])
  const ev = events || []
  const pr = props || []
  const stepOf = new Map(pr.map((p: any) => [p.id, p.step]))
  const ids = [...new Set([...ev.map((e: any) => e.driver_id), ...pr.map((p: any) => p.driver_id)].filter(Boolean))] as string[]
  const missionIds = [...new Set(ev.map((e: any) => e.mission_id).filter(Boolean))] as string[]
  const [{ data: users }, { data: missions }] = await Promise.all([
    ids.length ? sb.from('users').select('id, name').in('id', ids) : Promise.resolve({ data: [] as any[] }),
    missionIds.length ? sb.from('incoming_missions').select('id, mission_number, source, incident_city').in('id', missionIds.slice(0, 1000)) : Promise.resolve({ data: [] as any[] }),
  ])
  const name = (id: string | null) => (users || []).find((u: any) => u.id === id)?.name || '—'
  const count = (k: string, step?: string) => ev.filter((e: any) => e.kind === k && (!step || stepOf.get(e.proposal_id) === step)).length

  const missionsProposed = new Set(ev.filter((e: any) => e.kind === 'proposed').map((e: any) => e.mission_id)).size
  const accFirst = ev.filter((e: any) => e.kind === 'accepted' && stepOf.get(e.proposal_id) === 'night_first')
  const kpis = [
    { label: 'Missions proposées', value: String(missionsProposed) },
    { label: 'Acceptées par le 1er départ', value: String(accFirst.length), hint: `réponse en ${dur(med(accFirst.map((e: any) => e.data?.response_s).filter((x: any) => typeof x === 'number')))} (médiane)` },
    { label: '« Déjà en mission »', value: String(count('busy_declared')), hint: `${count('refused', 'night_first')} refus confirmés` },
    { label: 'Rappels 15 min', value: String(count('snoozed')) },
    { label: 'Appels au client', value: String(count('client_call')), hint: `${count('client_ok')} d’accord · ${count('client_ko')} pas d’accord` },
    { label: 'Appels téléphone (sans réponse à la notif)', value: String(count('called')) },
    { label: 'Passages à la réserve', value: String(count('proposed', 'reserve')), hint: `${count('accepted', 'reserve')} acceptées par la réserve · ${count('returned_to_first')} renvoyées au 1er` },
    { label: 'Au dispatch (personne n’a pris)', value: String(count('to_dispatcher')) },
    { label: 'Prises par un autre / Momo Market', value: String(count('taken_by_other') + count('claimed_in_market')) },
    { label: 'Attribuées par le dispatch en cours de route', value: String(count('assigned_by_dispatch')) },
  ]

  const perDriver = ids.map(id => {
    const mine = pr.filter((p: any) => p.driver_id === id)
    const myEv = ev.filter((e: any) => e.driver_id === id)
    const acc = myEv.filter((e: any) => e.kind === 'accepted')
    return {
      id, name: name(id),
      first: mine.filter((p: any) => p.step === 'night_first').length,
      reserve: mine.filter((p: any) => p.step === 'reserve').length,
      accepted: acc.length,
      refused: myEv.filter((e: any) => e.kind === 'refused' || e.kind === 'client_ko').length,
      noAnswer: myEv.filter((e: any) => e.kind === 'timeout').length,
      snoozed: myEv.filter((e: any) => e.kind === 'snoozed').length,
      median: med(acc.map((e: any) => e.data?.response_s).filter((x: any) => typeof x === 'number')),
    }
  }).filter(d => d.first + d.reserve > 0).sort((a, b) => (b.first + b.reserve) - (a.first + a.reserve))

  const byMission = new Map<string, any[]>()
  for (const e of ev) if (e.mission_id) byMission.set(e.mission_id, [...(byMission.get(e.mission_id) || []), e])
  const timeline = [...byMission.entries()].map(([mid, list]) => {
    const m = (missions || []).find((x: any) => x.id === mid)
    return {
      missionId: mid, number: m?.mission_number ?? null,
      label: [m?.source?.toUpperCase(), m?.incident_city].filter(Boolean).join(' · '),
      events: list.map((e: any) => ({
        at: e.created_at, kind: e.kind, label: KIND_LABEL[e.kind] || e.kind,
        driver: e.driver_id && e.kind !== 'to_dispatcher' ? name(e.driver_id) : null,
        extra: e.kind === 'eta' && e.data?.eta_min != null ? `≈ ${e.data.eta_min} min` : '',
      })),
    }
  }).sort((a, b) => b.events[0].at.localeCompare(a.events[0].at)).slice(0, 60)

  // ── Annoncé contre réalité ──
  const declarations: Declaration[] = []
  for (const e of ev.filter((x: any) => x.kind === 'eta')) {
    const d = e.data || {}
    const declaredMin = typeof d.minutes === 'number' ? d.minutes : null
    const estimatedFinishMin = typeof d.finish_min === 'number' ? d.finish_min : null
    let actualFinishMin: number | null = null
    const cur: string[] = Array.isArray(d.current_ids) ? d.current_ids : []
    if (cur.length) {
      const { data: done } = await sb.from('incoming_missions').select('completed_at, status').in('id', cur)
      const ends = (done || []).map((x: any) => x.completed_at).filter(Boolean) as string[]
      if (ends.length === cur.length) actualFinishMin = Math.max(...ends.map(t => minsBetween(e.created_at, t)))
    } else if (e.driver_id) {
      // Pas de fiche au moment de la déclaration (appel police…) : la première fiche
      // qu'il a eue ensuite (créée ou attribuée dans les 3 h), et sa clôture.
      const until3h = new Date(new Date(e.created_at).getTime() + 3 * 3600_000).toISOString()
      const { data: later } = await sb.from('incoming_missions').select('completed_at, assigned_at, created_at')
        .eq('assigned_to', e.driver_id).neq('id', e.mission_id || '00000000-0000-0000-0000-000000000000')
        .gte('created_at', new Date(new Date(e.created_at).getTime() - 3 * 3600_000).toISOString()).lte('created_at', until3h)
        .order('created_at').limit(1)
      const c = later?.[0]?.completed_at
      if (c && c > e.created_at) actualFinishMin = minsBetween(e.created_at, c)
    }
    const announcedMin = declaredMin ?? estimatedFinishMin
    const gapMin = actualFinishMin != null && announcedMin != null ? actualFinishMin - announcedMin : null
    const m = (missions || []).find((x: any) => x.id === e.mission_id)
    declarations.push({
      at: e.created_at, driverName: name(e.driver_id), missionNumber: m?.mission_number ?? null, missionId: e.mission_id,
      declaredMin, estimatedFinishMin, etaMin: typeof d.eta_min === 'number' ? d.eta_min : null,
      actualFinishMin, announcedMin, gapMin,
      verdict: gapMin == null ? 'pending' : gapMin < -TOLERANCE_MIN ? 'earlier' : gapMin > TOLERANCE_MIN ? 'later' : 'ok',
    })
  }
  declarations.sort((a, b) => b.at.localeCompare(a.at))

  return { since, until, empty: !ev.length, kpis, perDriver, timeline, declarations }
}

export const VERDICT_LABEL: Record<Declaration['verdict'], string> = {
  ok:      'Conforme',
  earlier: 'Fini bien plus tôt qu’annoncé',
  later:   'A pris plus longtemps qu’annoncé',
  pending: 'Pas encore terminé',
}

// ── Rapport du matin (mail HTML, compatible Outlook : tableaux + styles en ligne) ──

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const hmBx = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

export function renderNightReportHtml(s: NightStats, title: string, appUrl: string): string {
  const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827'
  const th = 'padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #d1d5db'
  if (s.empty) {
    return `<div style="font-family:Arial,sans-serif;color:#111827"><h2 style="margin:0 0 8px">${esc(title)}</h2>
      <p>Aucune mission n’a été proposée cette nuit par la garde de nuit automatique.</p>
      <p style="font-size:12px;color:#6b7280">Détail : <a href="${appUrl}/admin/garde-nuit">Administration → Garde de nuit</a></p></div>`
  }
  const kpi = s.kpis.map(k => `<tr><td style="${td}">${esc(k.label)}</td><td style="${td};font-weight:bold;text-align:right">${esc(k.value)}</td><td style="${td};color:#6b7280">${esc(k.hint || '')}</td></tr>`).join('')
  const decl = s.declarations.length ? s.declarations.map(d => {
    const color = d.verdict === 'earlier' ? '#b91c1c' : d.verdict === 'later' ? '#b45309' : d.verdict === 'ok' ? '#15803d' : '#6b7280'
    return `<tr><td style="${td}">${hmBx(d.at)}</td><td style="${td}">${esc(d.driverName)}</td><td style="${td}">${d.missionNumber ? `#${d.missionNumber}` : '—'}</td>
      <td style="${td};text-align:right">${d.declaredMin != null ? `${d.declaredMin} min` : '—'}</td>
      <td style="${td};text-align:right">${d.estimatedFinishMin != null ? `${d.estimatedFinishMin} min` : '—'}</td>
      <td style="${td};text-align:right">${d.actualFinishMin != null ? `${d.actualFinishMin} min` : '—'}</td>
      <td style="${td};color:${color};font-weight:bold">${esc(VERDICT_LABEL[d.verdict])}${d.gapMin != null ? ` (${d.gapMin > 0 ? '+' : ''}${d.gapMin} min)` : ''}</td></tr>`
  }).join('') : `<tr><td style="${td}" colspan="7">Aucun « Je suis déjà en mission » cette nuit.</td></tr>`
  const drivers = s.perDriver.map(d => `<tr><td style="${td}">${esc(d.name)}</td><td style="${td};text-align:right">${d.first}</td><td style="${td};text-align:right">${d.reserve}</td><td style="${td};text-align:right">${d.accepted}</td><td style="${td};text-align:right">${d.refused}</td><td style="${td};text-align:right">${d.noAnswer}</td><td style="${td};text-align:right">${d.snoozed}</td><td style="${td};text-align:right">${esc(dur(d.median))}</td></tr>`).join('')
  const tl = s.timeline.map(t => `<tr><td style="${td};white-space:nowrap">${t.number ? `<a href="${appUrl}/dispatch/${t.missionId}">#${t.number}</a>` : '—'}<br><span style="color:#6b7280;font-size:12px">${esc(t.label)}</span></td>
    <td style="${td}">${t.events.map(e => `${hmBx(e.at)} ${esc(e.label)}${e.driver ? ` · ${esc(e.driver)}` : ''}${e.extra ? ` · ${esc(e.extra)}` : ''}`).join('<br>')}</td></tr>`).join('')
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:760px">
  <h2 style="margin:0 0 4px">${esc(title)}</h2>
  <p style="margin:0 0 14px;color:#6b7280;font-size:13px">Missions proposées la nuit au 1er départ puis à la réserve.</p>
  <table style="border-collapse:collapse;width:100%;margin-bottom:18px">${kpi}</table>
  <h3 style="margin:0 0 6px;font-size:15px">Annoncé contre réalité (« Je suis déjà en mission »)</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:18px"><tr><th style="${th}">Heure</th><th style="${th}">Chauffeur</th><th style="${th}">Mission proposée</th><th style="${th};text-align:right">Annoncé</th><th style="${th};text-align:right">Estimé</th><th style="${th};text-align:right">Réel</th><th style="${th}">Verdict</th></tr>${decl}</table>
  <h3 style="margin:0 0 6px;font-size:15px">Par chauffeur</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:18px"><tr><th style="${th}">Chauffeur</th><th style="${th};text-align:right">1er départ</th><th style="${th};text-align:right">Réserve</th><th style="${th};text-align:right">Acceptées</th><th style="${th};text-align:right">Refus</th><th style="${th};text-align:right">Sans réponse</th><th style="${th};text-align:right">Rappels</th><th style="${th};text-align:right">Réponse médiane</th></tr>${drivers}</table>
  <h3 style="margin:0 0 6px;font-size:15px">Déroulé mission par mission</h3>
  <table style="border-collapse:collapse;width:100%">${tl}</table>
  <p style="font-size:12px;color:#6b7280;margin-top:14px">« Annoncé » : ce que le chauffeur a dit (ou, avec une fiche en cours, le temps estimé par l’app pour la terminer). « Réel » : clôture effective de sa mission, comptée depuis sa réponse. Écart toléré : ${TOLERANCE_MIN} min. Détail : <a href="${appUrl}/admin/garde-nuit">Administration → Garde de nuit</a></p>
</div>`
}

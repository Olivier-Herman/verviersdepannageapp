// src/app/admin/garde-nuit/page.tsx
//
// Statistiques de la garde de nuit (Olivier 30/09/2026) : chaque mission proposée,
// acceptée, refusée, rappel 15 min, appel client, passage à la réserve, renvoi au
// 1er départ, mission finalement dispatchée… Source : market_proposal_events
// (journal écrit par lib/missions/market-proposals.ts) + market_proposals.

import Link from 'next/link'
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  proposed: 'Proposée', called: 'Appel', accepted: 'Acceptée', busy_declared: '« Déjà en mission »',
  eta: 'Estimation', refused: 'Refus confirmé', snoozed: 'Rappel 15 min', reminded: 'Reproposée',
  client_call: 'Appel au client', client_ok: 'Client d’accord', client_ko: 'Client pas d’accord',
  timeout: 'Sans réponse', to_dispatcher: 'Au dispatch', returned_to_first: 'Renvoyée au 1er départ',
  taken_by_other: 'Prise par un autre', assigned_by_dispatch: 'Attribuée par le dispatch', claimed_in_market: 'Prise dans Momo Market',
}
const TONE: Record<string, string> = {
  accepted: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  client_ok: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  refused: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  client_ko: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  timeout: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  to_dispatcher: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
}
const hm = (iso: string) => new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const dur = (s: number | null) => s == null ? '—' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`

export default async function GardeNuitStatsPage({ searchParams }: { searchParams: { j?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard')

  const days = [7, 30, 90].includes(Number(searchParams.j)) ? Number(searchParams.j) : 30
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const sb = createAdminClient()
  const [{ data: events }, { data: props }] = await Promise.all([
    sb.from('market_proposal_events').select('proposal_id, mission_id, driver_id, kind, data, created_at').gte('created_at', since).order('created_at').limit(5000),
    sb.from('market_proposals').select('id, mission_id, driver_id, step, status').eq('is_test', false).gte('created_at', since).limit(5000),
  ])
  const ev = events || []
  const pr = props || []
  const stepOf = new Map(pr.map((p: any) => [p.id, p.step]))
  const ids = [...new Set([...ev.map((e: any) => e.driver_id), ...pr.map((p: any) => p.driver_id)].filter(Boolean))]
  const missionIds = [...new Set(ev.map((e: any) => e.mission_id).filter(Boolean))]
  const [{ data: users }, { data: missions }] = await Promise.all([
    ids.length ? sb.from('users').select('id, name').in('id', ids) : Promise.resolve({ data: [] as any[] }),
    missionIds.length ? sb.from('incoming_missions').select('id, mission_number, source, incident_city, assigned_to').in('id', missionIds.slice(0, 1000)) : Promise.resolve({ data: [] as any[] }),
  ])
  const name = (id: string | null) => (users || []).find((u: any) => u.id === id)?.name || '—'
  const count = (k: string, step?: string) => ev.filter((e: any) => e.kind === k && (!step || stepOf.get(e.proposal_id) === step)).length

  const missionsProposed = new Set(ev.filter((e: any) => e.kind === 'proposed').map((e: any) => e.mission_id)).size
  const accFirst = ev.filter((e: any) => e.kind === 'accepted' && stepOf.get(e.proposal_id) === 'night_first')
  const kpis: { label: string; value: string; hint?: string }[] = [
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

  // Par chauffeur (propositions reçues).
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

  // Déroulé par mission (les plus récentes d'abord).
  const byMission = new Map<string, any[]>()
  for (const e of ev) if (e.mission_id) byMission.set(e.mission_id, [...(byMission.get(e.mission_id) || []), e])
  const timeline = [...byMission.entries()]
    .map(([mid, list]) => ({ m: (missions || []).find((x: any) => x.id === mid), list }))
    .sort((a, b) => b.list[0].created_at.localeCompare(a.list[0].created_at))
    .slice(0, 60)

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-ink font-bold text-xl">🌙 Garde de nuit : statistiques</h1>
          <p className="text-ink-muted text-sm mt-1">Missions proposées la nuit au 1er départ puis à la réserve : réponses, délais, rappels, appels au client, passages au dispatch.</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map(d => (
            <Link key={d} href={`/admin/garde-nuit?j=${d}`} className={`min-h-[40px] px-3 inline-flex items-center rounded-lg text-sm font-semibold border ${d === days ? 'bg-brand text-white border-brand' : 'bg-surface text-ink border-slate-300 dark:border-slate-600'}`}>{d} jours</Link>
          ))}
        </div>
      </div>

      {!ev.length ? (
        <div className="bg-surface border rounded-2xl p-10 text-center">
          <p className="text-ink font-semibold">Aucune proposition de nuit sur les {days} derniers jours</p>
          <p className="text-ink-muted text-sm mt-1">Les chiffres apparaissent dès que la garde de nuit automatique a proposé une mission.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {kpis.map(k => (
              <div key={k.label} className="bg-surface border rounded-xl p-3">
                <p className="text-ink-muted text-xs">{k.label}</p>
                <p className="text-ink font-bold text-2xl tabular-nums">{k.value}</p>
                {k.hint && <p className="text-ink-faint text-[11px] mt-0.5">{k.hint}</p>}
              </div>
            ))}
          </div>

          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink font-semibold mb-2">Par chauffeur</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-ink-muted text-xs text-left">
                  <tr><th className="py-1 pr-3">Chauffeur</th><th className="pr-3">En 1er départ</th><th className="pr-3">En réserve</th><th className="pr-3">Acceptées</th><th className="pr-3">Refus</th><th className="pr-3">Sans réponse</th><th className="pr-3">Rappels 15 min</th><th>Réponse médiane</th></tr>
                </thead>
                <tbody>
                  {perDriver.map(d => (
                    <tr key={d.id} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1.5 pr-3 font-medium text-ink">{d.name}</td><td className="pr-3">{d.first}</td><td className="pr-3">{d.reserve}</td>
                      <td className="pr-3">{d.accepted}</td><td className="pr-3">{d.refused}</td><td className="pr-3">{d.noAnswer}</td><td className="pr-3">{d.snoozed}</td><td>{dur(d.median)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink font-semibold mb-2">Déroulé mission par mission</h2>
            <ul className="space-y-2">
              {timeline.map(({ m, list }) => (
                <li key={list[0].mission_id} className="border-t border-slate-200 dark:border-slate-700 pt-2 first:border-0 first:pt-0">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    {m ? <Link href={`/dispatch/${m.id}`} className="font-mono font-semibold text-brand hover:underline">#{m.mission_number}</Link> : <span className="text-ink-muted">Mission</span>}
                    <span className="text-ink-secondary">{[m?.source?.toUpperCase(), m?.incident_city].filter(Boolean).join(' · ')}</span>
                    <span className="text-ink-faint text-xs ml-auto">{hm(list[0].created_at)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {list.map((e: any, i: number) => (
                      <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full ${TONE[e.kind] || 'bg-slate-100 text-slate-800 dark:bg-slate-700/50 dark:text-slate-200'}`}>
                        {new Date(e.created_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })} {KIND_LABEL[e.kind] || e.kind}
                        {e.driver_id && !['to_dispatcher'].includes(e.kind) ? ` · ${name(e.driver_id)}` : ''}
                        {e.kind === 'eta' && e.data?.eta_min != null ? ` · ≈ ${e.data.eta_min} min` : ''}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

// src/app/admin/garde-nuit/page.tsx
//
// Statistiques de la garde de nuit (Olivier 30/09/2026) : chaque mission proposée,
// acceptée, refusée, rappel 15 min, appel client, passage à la réserve, renvoi au
// 1er départ, mission finalement dispatchée, et « annoncé contre réalité » des
// « Je suis déjà en mission ». Calculs partagés avec le rapport du matin :
// lib/missions/night-report.ts.

import Link from 'next/link'
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { loadNightStats, dur, VERDICT_LABEL } from '@/lib/missions/night-report'

export const dynamic = 'force-dynamic'

const TONE: Record<string, string> = {
  accepted: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  client_ok: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  refused: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  client_ko: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  timeout: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  to_dispatcher: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
}
const VERDICT_TONE: Record<string, string> = {
  ok: 'text-green-700 dark:text-green-300', earlier: 'text-red-700 dark:text-red-300',
  later: 'text-amber-700 dark:text-amber-300', pending: 'text-ink-muted',
}
const hm = (iso: string) => new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

export default async function GardeNuitStatsPage({ searchParams }: { searchParams: { j?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard')

  const days = [7, 30, 90].includes(Number(searchParams.j)) ? Number(searchParams.j) : 30
  const s = await loadNightStats(new Date(Date.now() - days * 86400_000).toISOString(), new Date().toISOString())

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-ink font-bold text-xl">🌙 Garde de nuit : statistiques</h1>
          <p className="text-ink-muted text-sm mt-1">Missions proposées la nuit au 1er départ puis à la réserve : réponses, délais, rappels, appels au client, passages au dispatch. Un résumé de la nuit est envoyé chaque matin à 8 h.</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map(d => (
            <Link key={d} href={`/admin/garde-nuit?j=${d}`} className={`min-h-[40px] px-3 inline-flex items-center rounded-lg text-sm font-semibold border ${d === days ? 'bg-brand text-white border-brand' : 'bg-surface text-ink border-slate-300 dark:border-slate-600'}`}>{d} jours</Link>
          ))}
        </div>
      </div>

      {s.empty ? (
        <div className="bg-surface border rounded-2xl p-10 text-center">
          <p className="text-ink font-semibold">Aucune proposition de nuit sur les {days} derniers jours</p>
          <p className="text-ink-muted text-sm mt-1">Les chiffres apparaissent dès que la garde de nuit automatique a proposé une mission.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {s.kpis.map(k => (
              <div key={k.label} className="bg-surface border rounded-xl p-3">
                <p className="text-ink-muted text-xs">{k.label}</p>
                <p className="text-ink font-bold text-2xl tabular-nums">{k.value}</p>
                {k.hint && <p className="text-ink-faint text-[11px] mt-0.5">{k.hint}</p>}
              </div>
            ))}
          </div>

          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink font-semibold">Annoncé contre réalité</h2>
            <p className="text-ink-muted text-xs mb-2">Pour chaque « Je suis déjà en mission » : ce que le chauffeur a annoncé (sinon le temps estimé par l’app pour terminer sa mission en cours), et le temps qu’il a réellement mis pour la clôturer. Écart toléré : 15 min.</p>
            {!s.declarations.length ? <p className="text-ink-muted text-sm">Aucun « Je suis déjà en mission » sur la période.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-ink-muted text-xs text-left">
                    <tr><th className="py-1 pr-3">Quand</th><th className="pr-3">Chauffeur</th><th className="pr-3">Mission proposée</th><th className="pr-3">Annoncé</th><th className="pr-3">Estimé par l’app</th><th className="pr-3">Réel</th><th>Verdict</th></tr>
                  </thead>
                  <tbody>
                    {s.declarations.map((d, i) => (
                      <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="py-1.5 pr-3">{hm(d.at)}</td>
                        <td className="pr-3 font-medium text-ink">{d.driverName}</td>
                        <td className="pr-3">{d.missionId && d.missionNumber ? <Link href={`/dispatch/${d.missionId}`} className="text-brand hover:underline font-mono">#{d.missionNumber}</Link> : '—'}</td>
                        <td className="pr-3">{d.declaredMin != null ? `${d.declaredMin} min` : '—'}</td>
                        <td className="pr-3">{d.estimatedFinishMin != null ? `${d.estimatedFinishMin} min` : '—'}{d.etaMin != null ? <span className="text-ink-faint text-xs"> (arrivée ≈ {d.etaMin} min)</span> : null}</td>
                        <td className="pr-3">{d.actualFinishMin != null ? `${d.actualFinishMin} min` : '—'}</td>
                        <td className={`font-semibold ${VERDICT_TONE[d.verdict]}`}>{VERDICT_LABEL[d.verdict]}{d.gapMin != null ? ` (${d.gapMin > 0 ? '+' : ''}${d.gapMin} min)` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink font-semibold mb-2">Par chauffeur</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-ink-muted text-xs text-left">
                  <tr><th className="py-1 pr-3">Chauffeur</th><th className="pr-3">En 1er départ</th><th className="pr-3">En réserve</th><th className="pr-3">Acceptées</th><th className="pr-3">Refus</th><th className="pr-3">Sans réponse</th><th className="pr-3">Rappels 15 min</th><th>Réponse médiane</th></tr>
                </thead>
                <tbody>
                  {s.perDriver.map(d => (
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
              {s.timeline.map(t => (
                <li key={t.missionId} className="border-t border-slate-200 dark:border-slate-700 pt-2 first:border-0 first:pt-0">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    {t.number ? <Link href={`/dispatch/${t.missionId}`} className="font-mono font-semibold text-brand hover:underline">#{t.number}</Link> : <span className="text-ink-muted">Mission</span>}
                    <span className="text-ink-secondary">{t.label}</span>
                    <span className="text-ink-faint text-xs ml-auto">{hm(t.events[0].at)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.events.map((e, i) => (
                      <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full ${TONE[e.kind] || 'bg-slate-100 text-slate-800 dark:bg-slate-700/50 dark:text-slate-200'}`}>
                        {hhmm(e.at)} {e.label}{e.driver ? ` · ${e.driver}` : ''}{e.extra ? ` · ${e.extra}` : ''}
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

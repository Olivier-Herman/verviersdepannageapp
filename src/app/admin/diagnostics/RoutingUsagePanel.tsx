'use client'

// Compteur des calculs d'itinéraire et d'adresse (Olivier 02/10/2026) : par
// jour, ce qui a été servi par la mémoire (gratuit), par le service gratuit
// (quota journalier) et par Google (payant). But : vérifier avec des chiffres
// que le quota gratuit suffit et voir tout de suite un appel Google.

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

type Row = { day: string; provider: 'memoire' | 'ors' | 'google'; service: 'itineraire' | 'matrice' | 'adresse'; origin: 'humain' | 'auto'; calls: number; failures: number }

// Quotas journaliers du service gratuit (offre publique OpenRouteService).
const FREE_QUOTA: Record<Row['service'], number> = { itineraire: 2000, matrice: 500, adresse: 1000 }
const COLS: { key: string; label: string; provider: Row['provider']; service: Row['service']; hint: string }[] = [
  { key: 'mem',  label: 'Trajets déjà connus', provider: 'memoire', service: 'itineraire', hint: 'Servis par la mémoire des trajets : gratuit, aucun quota.' },
  { key: 'ors',  label: 'Trajets gratuits',    provider: 'ors',     service: 'itineraire', hint: `Service gratuit, ${FREE_QUOTA.itineraire} par jour.` },
  { key: 'mat',  label: 'Listes chauffeurs',   provider: 'ors',     service: 'matrice',    hint: `Temps des chauffeurs vers une panne (fenêtre d'assignation), ${FREE_QUOTA.matrice} par jour.` },
  { key: 'orsA', label: 'Adresses gratuites',  provider: 'ors',     service: 'adresse',    hint: `Service gratuit, ${FREE_QUOTA.adresse} par jour.` },
  { key: 'gR',   label: 'Trajets Google',      provider: 'google',  service: 'itineraire', hint: 'Payant. Ne devrait venir que d’un geste humain (Calculer, Facturer).' },
  { key: 'gA',   label: 'Adresses Google',     provider: 'google',  service: 'adresse',    hint: 'Payant. Une fois par adresse, les coordonnées sont ensuite gardées sur la fiche.' },
]
const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit' })

export default function RoutingUsagePanel() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true); setErr(null)
    try { const r = await fetch('/api/admin/routing-usage', { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setRows(j.rows) }
    catch (e: any) { setErr(e?.message || 'Erreur') } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])

  const days = rows ? Array.from(new Set(rows.map(r => r.day))).sort().reverse() : []
  const cell = (day: string, c: typeof COLS[number]) => {
    const rs = (rows || []).filter(r => r.day === day && r.provider === c.provider && r.service === c.service)
    const calls = rs.reduce((s, r) => s + r.calls, 0), fails = rs.reduce((s, r) => s + r.failures, 0)
    const auto = rs.filter(r => r.origin === 'auto').reduce((s, r) => s + r.calls, 0)
    return { calls, fails, auto }
  }
  const today = days[0]
  const warn: string[] = []
  if (today && rows) {
    for (const c of COLS.filter(c => c.provider === 'ors')) {
      const { calls } = cell(today, c); const q = FREE_QUOTA[c.service]
      if (calls >= q * 0.8) warn.push(`${c.label} : ${calls} sur ${q} aujourd’hui — le quota gratuit est presque atteint.`)
    }
    const gAuto = cell(today, COLS.find(c => c.key === 'gR')!).auto
    if (gAuto > 0) warn.push(`${gAuto} trajet(s) Google aujourd’hui sans geste humain : à examiner.`)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold">Calculs de trajets et d’adresses</h2>
        <button onClick={load} disabled={busy} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-semibold border bg-surface text-ink-secondary hover:text-ink disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualiser
        </button>
      </div>
      <div className="bg-surface border rounded-2xl p-4 space-y-3">
        <p className="text-ink-muted text-sm">Chaque jour : ce qui a été servi par la mémoire (gratuit), par le service gratuit (limité par jour) et par Google (payant). Entre parenthèses : la part faite par les robots ou les écrans qui s’affichent seuls.</p>
        {warn.map(w => <p key={w} className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2">⚠ {w}</p>)}
        {err && <p className="text-sm text-red-700">⚠ {err}</p>}
        {rows === null && !err && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Chargement…</p>}
        {rows && days.length === 0 && <p className="text-sm text-ink-muted">Aucun calcul compté pour l’instant. Le compteur démarre avec ce déploiement.</p>}
        {rows && days.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="py-1.5 pr-3 font-semibold">Jour</th>
                  {COLS.map(c => <th key={c.key} title={c.hint} className="py-1.5 px-2 font-semibold text-right whitespace-nowrap">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {days.map(d => (
                  <tr key={d} className="border-t">
                    <td className="py-1.5 pr-3 text-ink whitespace-nowrap">{fmtDay(d)}</td>
                    {COLS.map(c => {
                      const v = cell(d, c)
                      const q = c.provider === 'ors' ? FREE_QUOTA[c.service] : null
                      const tone = c.provider === 'google' && v.calls > 0 ? 'text-red-700 font-semibold' : q && v.calls >= q * 0.8 ? 'text-amber-700 font-semibold' : 'text-ink'
                      return (
                        <td key={c.key} className={`py-1.5 px-2 text-right whitespace-nowrap ${tone}`} title={v.fails ? `${v.fails} échec(s)` : undefined}>
                          {v.calls || <span className="text-ink-faint">0</span>}{q ? <span className="text-ink-faint text-xs"> / {q}</span> : null}
                          {v.calls > 0 && c.provider !== 'memoire' && <span className="text-ink-muted text-xs"> ({v.auto})</span>}
                          {v.fails > 0 && <span className="text-red-700 text-xs"> · {v.fails} ✗</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

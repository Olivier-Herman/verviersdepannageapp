'use client'

// Consommation d'IA de VD Soft (table conso_ia, Olivier 03/10/2026) : coût et
// nombre d'appels par fonction, et total par jour. Montants en dollars, au
// tarif du service d'IA.

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

type Fn = { fonction: string; appels: number; erreurs: number; cout: number; declencheurs: string[]; modeles: string[] }
type Data = { jours: number; total: { appels: number; cout: number }; fonctions: Fn[]; jours_detail: { jour: string; appels: number; cout: number }[] }
const usd = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(0)} $`

export default function AiUsagePanel() {
  const [jours, setJours] = useState(7)
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async (n = jours) => {
    setBusy(true); setErr(null)
    try { const r = await fetch(`/api/admin/conso-ia?jours=${n}`, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setD(j) }
    catch (e: any) { setErr(e?.message || 'Erreur') } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-3 px-1 flex-wrap">
        <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold">Consommation d’IA</h2>
        <div className="flex items-center gap-2">
          {[1, 7, 30].map(n => (
            <button key={n} onClick={() => { setJours(n); load(n) }} className={`min-h-[44px] px-3 rounded-xl text-sm font-semibold border ${jours === n ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary'}`}>{n === 1 ? '24 h' : `${n} j`}</button>
          ))}
          <button onClick={() => load()} disabled={busy} aria-label="Actualiser" className="min-h-[44px] px-3 rounded-xl border bg-surface text-ink-secondary disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
        </div>
      </div>
      <div className="bg-surface border rounded-2xl p-4 space-y-3">
        {err && <p className="text-sm text-red-700">⚠ {err}</p>}
        {!d && !err && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Chargement…</p>}
        {d && d.total.appels === 0 && <p className="text-sm text-ink-muted">Aucun appel compté sur la période. Le compteur démarre avec ce déploiement.</p>}
        {d && d.total.appels > 0 && (
          <>
            <p className="text-ink text-sm"><b className="text-lg tabular-nums">{usd(d.total.cout)}</b> pour <b className="tabular-nums">{d.total.appels}</b> appels sur {d.jours === 1 ? '24 h' : `${d.jours} jours`}.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="py-1.5 pr-3 font-semibold">Fonction</th><th className="py-1.5 px-2 font-semibold text-right">Appels</th><th className="py-1.5 px-2 font-semibold text-right">Erreurs</th><th className="py-1.5 px-2 font-semibold text-right">Coût</th><th className="py-1.5 pl-2 font-semibold">Déclenché par</th>
                </tr></thead>
                <tbody>
                  {d.fonctions.map(f => (
                    <tr key={f.fonction} className="border-t">
                      <td className="py-1.5 pr-3 text-ink" title={f.modeles.join(', ')}>{f.fonction}</td>
                      <td className="py-1.5 px-2 text-right">{f.appels}</td>
                      <td className={`py-1.5 px-2 text-right ${f.erreurs ? 'text-red-700 font-semibold' : 'text-ink-faint'}`}>{f.erreurs}</td>
                      <td className="py-1.5 px-2 text-right font-semibold">{usd(f.cout)}</td>
                      <td className="py-1.5 pl-2 text-ink-muted text-xs">{f.declencheurs.slice(0, 3).join(', ') || 'écran'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.jours_detail.length > 1 && (
              <p className="text-xs text-ink-muted">Par jour : {d.jours_detail.map(j => `${j.jour.slice(8, 10)}/${j.jour.slice(5, 7)} ${usd(j.cout)}`).join(' · ')}</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

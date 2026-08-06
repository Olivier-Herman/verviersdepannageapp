'use client'
// src/components/stats/TouringDeroulement.tsx
// Tableau « Déroulement Touring » : heures de pointage telles que COMEX les détient
// (= reçues par Touring) + délais SLA colorés. Olivier 2026-08-06.

import { useEffect, useState, useCallback } from 'react'

const fmtH = (iso?: string | null) => {
  if (!iso) return '—'; const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}
const fmtDate = (iso?: string | null) => {
  if (!iso) return ''; const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })
}
const STATUT: Record<string, string> = { '03': 'À valider', '04': 'Accepté', '05': 'En route', '06': 'Sur place', '07': 'Terminé' }

export default function TouringDeroulement() {
  const [rows, setRows] = useState<any[] | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    fetch('/api/stats/touring-deroulement')
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setRows(d.rows || []) })
      .catch(() => setErr('Erreur de lecture COMEX'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const delaiCls = (ok: boolean | null) => ok === null ? 'text-ink-faint' : ok ? 'text-green-600' : 'text-red-600 font-bold'
  const cell = (h: string | null | undefined, delai: number | null, ok: boolean | null) => (
    <td className="pr-3 py-1.5 whitespace-nowrap">
      {fmtH(h)}{delai != null && <span className={`ml-1 ${delaiCls(ok)}`}>+{delai}′</span>}
    </td>
  )

  return (
    <div className="bg-surface border rounded-2xl p-4 mt-6">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h2 className="text-lg font-bold text-ink">🚗 Déroulement Touring</h2>
        <span className="text-xs text-ink-secondary">heures telles que COMEX les détient (= reçues par Touring)</span>
        <button onClick={load} disabled={loading}
          className="ml-auto text-xs px-2.5 py-1 rounded-lg border text-ink-secondary hover:text-ink disabled:opacity-50">
          {loading ? '…' : '↻ Rafraîchir'}
        </button>
      </div>

      {err && <div className="text-critical text-sm py-2">{err}</div>}
      {loading && !rows && <div className="text-ink-secondary text-sm py-4">Chargement (lecture COMEX en direct)…</div>}
      {rows && rows.length === 0 && <div className="text-ink-secondary text-sm py-4">Aucune mission Touring active.</div>}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-secondary text-left border-b">
                <th className="py-2 pr-3">Dossier</th>
                <th className="pr-3">Plaque</th>
                <th className="pr-3">Lieu</th>
                <th className="pr-3">Statut</th>
                <th className="pr-3">1er appel</th>
                <th className="pr-3">Accepté</th>
                <th className="pr-3">En route</th>
                <th className="pr-3">Sur place</th>
                <th className="pr-3">Fin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line/40 hover:bg-surface-2/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="font-mono">{r.cidDos}</span><span className="text-ink-faint">/{r.seq}</span>
                    <span className="text-ink-faint ml-1">{fmtDate(r.creation)}</span>
                  </td>
                  <td className="pr-3 font-mono font-bold whitespace-nowrap">{r.plate}</td>
                  <td className="pr-3 whitespace-nowrap">{r.loc}{r.gar && <span className="text-ink-faint ml-1">· {r.gar}</span>}</td>
                  <td className="pr-3 whitespace-nowrap">{STATUT[r.statut] || r.statut}</td>
                  <td className="pr-3 py-1.5 whitespace-nowrap">{fmtH(r.premierAppel)}</td>
                  {cell(r.accepte, r.acceptDelai, r.acceptOk)}
                  {cell(r.enRoute, r.enRouteDelai, r.enRouteOk)}
                  {cell(r.surPlace, r.surPlaceDelai, r.surPlaceOk)}
                  <td className="pr-3 py-1.5 whitespace-nowrap">{fmtH(r.fin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-ink-secondary mt-2">
            Délais : <b>accepté</b> ≤ 7′ (après envoi) · <b>en route</b> ≤ 10′ (après accept) · <b>sur place</b> ≤ 45′ (après accept). <span className="text-green-600">Vert</span> = dans les temps, <span className="text-red-600 font-bold">rouge</span> = dépassé.
          </div>
        </div>
      )}
    </div>
  )
}

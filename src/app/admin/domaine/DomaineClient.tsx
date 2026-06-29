'use client'

import { useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

interface Row {
  mission_number: number | null; plate: string; vehicle: string; dossier: string
  remise: string; vente: string; days: number; rate: number | null; amount: number
}
const fmt = (ymd: string) => ymd ? ymd.split('-').reverse().join('/') : ''

export default function DomaineClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totalDays, setTotalDays] = useState(0)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function setQuarter(q: number) {
    const m0 = (q - 1) * 3
    const start = new Date(Date.UTC(year, m0, 1))
    const end   = new Date(Date.UTC(year, m0 + 3, 0))   // dernier jour du trimestre
    setFrom(start.toISOString().slice(0, 10))
    setTo(end.toISOString().slice(0, 10))
  }

  async function load() {
    if (!from || !to) { setMsg('⚠ Choisis la période'); return }
    setLoading(true); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/domaine?from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); setRows(null); return }
      setRows(j.rows); setTotal(j.total); setTotalDays(j.totalDays)
    } catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }

  return (
    <AppShell title="Domaine — Gardiennage État" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <main className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5">
        <Link href="/admin" className="text-ink-muted text-sm">← Administration</Link>
        <div>
          <h1 className="text-ink text-xl font-bold">🏛️ Gardiennage Domaine (État)</h1>
          <p className="text-ink-muted text-sm">Jours de gardiennage des véhicules remis au Domaine (remise → vente), au tarif parc saisie. Tableau + export Excel trimestriel.</p>
        </div>

        <div className="bg-surface border rounded-2xl p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-ink-muted text-xs mb-1">Année</label>
              <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
                className="w-24 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map(q => (
                <button key={q} type="button" onClick={() => setQuarter(q)}
                  className="px-3 py-2 bg-surface-2 border rounded-xl text-ink-secondary text-sm font-semibold hover:border-brand/40">
                  T{q}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <div>
              <label className="block text-ink-muted text-xs mb-1">Du</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-ink-muted text-xs mb-1">Au</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={load} disabled={loading}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {loading ? '⏳…' : '🔎 Afficher'}
            </button>
            <button type="button"
              onClick={() => { if (!from || !to) { setMsg('⚠ Choisis la période'); return } window.location.href = `/api/fourriere/domaine/export?from=${from}&to=${to}` }}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold">
              ⬇️ Export Excel
            </button>
          </div>
          {msg && <p className="text-sm text-amber-600">{msg}</p>}
        </div>

        {rows && (
          rows.length === 0 ? (
            <p className="text-ink-muted py-8 text-center">Aucun véhicule au Domaine sur cette période.</p>
          ) : (
            <div className="bg-surface border rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-muted text-xs uppercase border-b">
                    <th className="text-left px-3 py-2">Plaque</th>
                    <th className="text-left px-3 py-2">Véhicule</th>
                    <th className="text-left px-3 py-2">Remise</th>
                    <th className="text-left px-3 py-2">Vente</th>
                    <th className="text-right px-3 py-2">Jours</th>
                    <th className="text-right px-3 py-2">€/j</th>
                    <th className="text-right px-3 py-2">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-ink">{r.plate}</td>
                      <td className="px-3 py-2 text-ink-secondary">{r.vehicle || '—'}</td>
                      <td className="px-3 py-2 text-ink-secondary">{fmt(r.remise)}</td>
                      <td className="px-3 py-2 text-ink-secondary">{r.vente ? fmt(r.vente) : <span className="text-amber-600">en cours</span>}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.days}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{r.rate != null ? r.rate.toFixed(2) : '—'}</td>
                      <td className="px-3 py-2 text-right text-ink font-semibold">{r.amount.toFixed(2)} €</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-2 font-bold">
                    <td className="px-3 py-2" colSpan={4}>TOTAL ({rows.length} véhicule{rows.length > 1 ? 's' : ''})</td>
                    <td className="px-3 py-2 text-right">{totalDays}</td>
                    <td></td>
                    <td className="px-3 py-2 text-right">{total.toFixed(2)} €</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        )}
      </main>
    </AppShell>
  )
}

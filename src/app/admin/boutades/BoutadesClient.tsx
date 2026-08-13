'use client'

// src/app/admin/boutades/BoutadesClient.tsx
// Tableau des boutades (vannes humoristiques affichées à Franck à l'acceptation).
// Visible seulement par Mobi (superadmin). N'apparaît pas sur les fiches.

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Boutade {
  id: string
  created_at: string
  driver_name: string | null
  text: string
  via: string | null
  vehicle: string | null
  city: string | null
  mission_id: string | null
}

const VIA_LABEL: Record<string, { label: string; cls: string }> = {
  ia:              { label: 'IA',      cls: 'bg-sky-500/15 text-sky-600' },
  repli:           { label: 'Repli',   cls: 'bg-amber-500/15 text-amber-600' },
  'sujet-sérieux': { label: 'Sérieux', cls: 'bg-slate-500/15 text-slate-500' },
}

export default function BoutadesClient() {
  const [rows, setRows]       = useState<Boutade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/boutades', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(j.boutades || [])
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const fmt = (iso: string) => new Date(iso).toLocaleString('fr-BE', {
    timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-ink text-2xl font-bold flex items-center gap-2">🃏 Boutades</h1>
          <p className="text-ink-muted text-sm">Les vannes affichées à Franck à l'acceptation — privé (Mobi).</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 border rounded-xl text-sm text-ink hover:bg-surface disabled:opacity-40">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Rafraîchir
        </button>
      </div>

      {error && <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm mb-4">⚠ {error}</div>}

      {loading && !rows.length ? (
        <div className="flex items-center justify-center py-16 text-ink-muted"><RefreshCw size={22} className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-surface-2 border rounded-2xl p-8 text-center text-ink-muted">Aucune boutade pour l'instant.</div>
      ) : (
        <div className="bg-surface border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-ink-muted text-xs uppercase tracking-wider">
                  <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Date</th>
                  <th className="text-left font-semibold px-3 py-2.5">Boutade</th>
                  <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Véhicule · Ville</th>
                  <th className="text-left font-semibold px-3 py-2.5">Mode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(b => {
                  const via = VIA_LABEL[b.via || ''] || { label: b.via || '—', cls: 'bg-surface-2 text-ink-muted' }
                  return (
                    <tr key={b.id} className="border-t align-top">
                      <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap tabular-nums">{fmt(b.created_at)}</td>
                      <td className="px-3 py-2.5 text-ink">
                        {b.mission_id
                          ? <a href={`/dispatch/${b.mission_id}`} className="hover:underline">{b.text}</a>
                          : b.text}
                      </td>
                      <td className="px-3 py-2.5 text-ink-secondary whitespace-nowrap">
                        {[b.vehicle, b.city].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded ${via.cls}`}>{via.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

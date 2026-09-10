'use client'
// Dossiers de destruction : recherche par VIN (même partiel), marque, modèle, couleur,
// n° de dossier, période — les plaques ont disparu, on ne les cherche qu'en secours.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Row { id: string; dossier_number: string; vin: string | null; plate: string | null; brand: string | null; model: string | null; color: string | null; photos: string[]; parc_zone_key: string | null; entered_at: string | null; exited_at: string; forced: boolean; epaviste: string | null; cost_snapshot: any }
const fmtD = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export default function DossiersClient() {
  const router = useRouter()
  const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState('')
  const load = async () => {
    setLoading(true); setErr('')
    try {
      const p = new URLSearchParams(); if (q.trim()) p.set('q', q.trim()); if (from) p.set('from', from); if (to) p.set('to', to)
      const r = await fetch(`/api/fourriere/destruction-dossiers?${p}`, { cache: 'no-store' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur'); setRows(j.dossiers || [])
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])
  return (
    <main className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-ink text-xl font-bold">🗂️ Dossiers de destruction</h1>
          <p className="text-ink-muted text-sm">Un dossier par véhicule parti à la casse : photos, état constaté, frais à n'importe quelle date. Rien n'est envoyé à la commune.</p>
        </div>
        <Link href="/fourriere/destruction/dossiers/nouveau" className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold">📷 Nouveau dossier</Link>
      </div>
      <form onSubmit={e => { e.preventDefault(); load() }} className="bg-surface border rounded-2xl p-3 mb-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
        <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">VIN, marque, modèle, couleur, n° de dossier</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ex. WVW…, Golf, grise, DEST-2026-0003" className="w-full bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" /></label>
        <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">Sortie du</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm" /></label>
        <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">au</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm" /></label>
        <button type="submit" className="px-4 py-2 bg-surface-2 border rounded-xl text-sm font-semibold text-ink">Chercher</button>
      </form>
      {err && <p className="text-critical text-sm mb-3">⚠ {err}</p>}
      {loading ? <p className="text-ink-muted py-8 text-center">Chargement…</p>
        : rows.length === 0 ? <p className="text-ink-muted py-12 text-center">Aucun dossier{q ? ` pour « ${q} »` : ''}.</p>
        : <div className="space-y-2">
          {rows.map(r => (
            <button key={r.id} type="button" onClick={() => router.push(`/fourriere/destruction/dossiers/${r.id}`)}
              className="w-full text-left bg-surface border rounded-2xl p-3 hover:border-brand/40 transition flex gap-3 items-center">
              {r.photos?.[0] ? <img src={r.photos[0]} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-surface-2" /> : <div className="w-16 h-16 rounded-lg bg-surface-2 flex items-center justify-center text-2xl flex-shrink-0">🚗</div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-ink-secondary">{r.dossier_number}</span>
                  <span className="text-ink font-semibold">{[r.brand, r.model].filter(Boolean).join(' ') || 'Véhicule non identifié'}</span>
                  {r.color && <span className="text-ink-secondary text-sm">· {r.color}</span>}
                  {r.forced && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">SORTIE FORCÉE</span>}
                </div>
                <p className="text-ink-muted text-xs mt-0.5 font-mono">{r.vin ? `VIN ${r.vin}` : 'VIN non lu'}{r.plate ? ` · ${r.plate}` : ''}</p>
                <p className="text-ink-faint text-xs mt-0.5">Entré le {fmtD(r.entered_at)} · parti le {fmtD(r.exited_at)}{r.parc_zone_key ? ` · zone ${r.parc_zone_key}` : ''} · {r.photos?.length || 0} photos</p>
              </div>
              <span className="text-ink-faint">›</span>
            </button>
          ))}
        </div>}
    </main>
  )
}

'use client'
// Choix d'une fiche pour un appel : fiches proposées + recherche (plaque, nom, n° de fiche, téléphone). Olivier 24/11/2026.
import { useEffect, useRef, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'

export interface FicheChoix { id: string; titre: string; detail: string }

export default function ChoisirFiche({ proposees, choisie, onChoisir, autoFocus }: {
  proposees: FicheChoix[]; choisie: string | null; onChoisir: (f: FicheChoix) => void; autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<FicheChoix[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setRes(null); setErr(null); return }
    const n = ++seq.current
    const h = setTimeout(async () => {
      setBusy(true); setErr(null)
      try {
        const r = await fetch(`/api/appels?q=${encodeURIComponent(t)}`, { cache: 'no-store' })
        const j = await r.json()
        if (n !== seq.current) return
        if (!r.ok) throw new Error(j.error || 'Recherche impossible')
        setRes(j.fiches || [])
      } catch (e: any) { if (n === seq.current) setErr(e.message) } finally { if (n === seq.current) setBusy(false) }
    }, 300)
    return () => clearTimeout(h)
  }, [q])

  const bouton = (f: FicheChoix) => (
    <button key={f.id} type="button" onClick={() => onChoisir(f)}
      className={`flex flex-col items-start gap-0.5 min-h-[44px] px-3 py-2 rounded-lg text-left text-sm ${choisie === f.id ? 'border-2 border-blue-700 bg-blue-50 text-slate-900' : 'border bg-surface text-ink hover:bg-surface-hover'}`}>
      <span className="font-semibold">{f.titre}</span>
      <span className="text-xs text-ink-secondary">{f.detail}</span>
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      {proposees.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Fiches probables</span>
          <div className="flex flex-wrap gap-2">{proposees.map(bouton)}</div>
        </div>
      )}
      <label className="flex items-center gap-2 min-h-[44px] px-3 rounded-lg border bg-surface-2">
        {busy ? <Loader2 size={16} className="animate-spin text-ink-muted" /> : <Search size={16} className="text-ink-muted" />}
        <span className="sr-only">Chercher une autre fiche</span>
        <input autoFocus={autoFocus} value={q} onChange={e => setQ(e.target.value)} placeholder="Autre fiche : plaque, nom, n° de fiche, téléphone"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm text-ink" />
      </label>
      {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      {res && (res.length ? <div className="flex flex-wrap gap-2">{res.map(bouton)}</div>
        : <p className="text-sm text-ink-muted">Aucune fiche ne correspond à « {q.trim()} ».</p>)}
    </div>
  )
}

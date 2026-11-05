'use client'
// Pastille Chauffeur / Dispatch de l'en-tête (Olivier 05/11/2026). Vers Dispatch : immédiat. Vers Chauffeur : confirmation,
// car ce sens coupe les alertes du dispatch ; le dispatcher de garde désigne d'abord qui prend le relais.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { WorkMode } from '@/lib/work-mode-view'

export default function WorkModeButton({ mode }: { mode: WorkMode }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deGarde, setDeGarde] = useState(false)
  const [remplacants, setRemplacants] = useState<{ id: string; name: string }[]>([])
  const [remplacant, setRemplacant] = useState('')

  async function apply(next: WorkMode) {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/users/me/work-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next, remplacant_id: remplacant || undefined }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Le changement n’a pas abouti.')
      // Le menu change entièrement : on repart de l'accueil, sans le menu gardé en mémoire.
      try { window.localStorage.removeItem('vd_nav_cache') } catch {}
      window.location.assign('/dashboard')
    } catch (e: any) {
      setError(e?.message || 'Le changement n’a pas abouti.')
      if (next === 'dispatch') setOpen(true)
      setBusy(false)
    }
  }

  async function onTap() {
    if (busy) return
    if (mode === 'chauffeur') return apply('dispatch')
    setOpen(true); setError(''); setRemplacant(''); setLoading(true)
    try {
      const j = await fetch('/api/users/me/work-mode', { cache: 'no-store' }).then(r => r.json())
      setDeGarde(!!j.de_garde)
      setRemplacants(j.remplacants || [])
    } catch { setError('Impossible de vérifier la garde. Réessaie.') }
    setLoading(false)
  }

  const peutConfirmer = mode === 'dispatch' && !loading && !busy && (!deGarde || !!remplacant)

  return (
    <>
      <button type="button" onClick={onTap} disabled={busy} aria-label={`Mode ${mode === 'chauffeur' ? 'Chauffeur' : 'Dispatch'}. Appuyer pour changer.`}
        className="flex min-h-[44px] flex-shrink-0 items-center disabled:opacity-60">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold whitespace-nowrap ${mode === 'chauffeur'
          ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300'}`}>
          {mode === 'chauffeur' ? 'Chauffeur' : 'Dispatch'}
        </span>
      </button>

      {open && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="my-auto w-full max-w-md space-y-3 rounded-2xl border bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold text-ink">{mode === 'dispatch' ? 'Passer en Chauffeur ?' : 'Retour en Dispatch'}</h3>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Fermer" className="-m-2 flex h-11 w-11 flex-shrink-0 items-center justify-center text-ink-secondary"><X size={18} /></button>
            </div>
            {mode === 'dispatch' && <p className="text-sm text-ink-secondary">Tu ne recevras plus les alertes du dispatch. Quelqu’un d’autre doit l’assurer.</p>}
            {loading && <p className="text-sm text-ink-muted">Vérification de la garde…</p>}
            {mode === 'dispatch' && !loading && deGarde && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink">Tu es dispatcher de garde. Qui prend le relais ?</p>
                {remplacants.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Personne d’autre ne peut prendre la garde pour l’instant. Tu restes en Dispatch.</p>}
                {remplacants.map(r => (
                  <button key={r.id} type="button" onClick={() => setRemplacant(r.id)} aria-pressed={remplacant === r.id}
                    className={`min-h-[44px] w-full rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold text-ink ${remplacant === r.id ? 'border-brand bg-brand-soft' : ''}`}>{r.name}</button>
                ))}
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="min-h-[48px] rounded-xl border font-semibold text-ink">Annuler</button>
              {mode === 'dispatch'
                ? <button type="button" onClick={() => apply('chauffeur')} disabled={!peutConfirmer} className="min-h-[48px] rounded-xl bg-brand px-2 font-bold text-white disabled:opacity-50">{busy ? 'Un instant…' : 'Oui, je suis chauffeur'}</button>
                : <button type="button" onClick={() => apply('dispatch')} disabled={busy} className="min-h-[48px] rounded-xl bg-brand px-2 font-bold text-white disabled:opacity-50">{busy ? 'Un instant…' : 'Réessayer'}</button>}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  )
}

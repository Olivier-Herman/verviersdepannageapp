'use client'

// src/components/dispatch/AxaImportButton.tsx
//
// Bouton « Import AXA » (go&assist) dans la sticky bar /dispatch. Preview puis
// send → INSERT direct dans incoming_missions (poll API, pas de mail). Même helper
// runAxaImport que le cron. Modal : fermeture par ✕/Fermer uniquement (pas de
// clic-fond, cf mémoire).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, CheckCircle2 } from 'lucide-react'

interface Item {
  missionOrderId: string
  caseId:         string
  plate:          string
  serviceCode:    string
  mission_type:   string
  client_name:    string
  incident_city:  string
  axaStatus:      string
  exists:         boolean
}
interface Result {
  ok: boolean; mode: 'preview' | 'send'; awaiting: number; news: number
  items: Item[]; imported: number; skipped: number; errors: string[]
}

export default function AxaImportButton({ onImportDone }: { onImportDone?: () => void }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase]     = useState<'preview' | 'sending' | 'done'>('preview')
  const [preview, setPreview] = useState<Result | null>(null)
  const [sent, setSent]       = useState<Result | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function openAndPreview() {
    setOpen(true); setPhase('preview'); setPreview(null); setSent(null); setError(null); setLoading(true)
    try {
      const res = await fetch('/api/axa/import?mode=preview', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setPreview(j)
    } catch (e: any) { setError(e.message || 'Erreur réseau') } finally { setLoading(false) }
  }
  async function triggerSend() {
    setPhase('sending'); setLoading(true); setError(null)
    try {
      const res = await fetch('/api/axa/import?mode=send', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setSent(j); setPhase('done'); onImportDone?.()
    } catch (e: any) { setError(e.message || 'Erreur réseau'); setPhase('preview') } finally { setLoading(false) }
  }
  function close() { setOpen(false); setPreview(null); setSent(null); setError(null) }

  const news = preview?.items.filter(i => !i.exists) || []
  const olds = preview?.items.filter(i => i.exists) || []

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const modal = open && typeof window !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border-2 border-sky-500/30 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="h-1.5 bg-gradient-to-r from-sky-500 to-blue-600" />
        <div className="px-5 py-4 border-b flex items-center justify-between bg-sky-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-xl">🅰️</div>
            <div>
              <h2 className="text-ink font-bold">Import AXA</h2>
              <p className="text-ink-muted text-xs">go&amp;assist → dispatch</p>
            </div>
          </div>
          <button onClick={close} disabled={loading} className="text-ink-muted hover:text-critical disabled:opacity-30 p-1.5"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm font-semibold">⚠ {error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-ink-muted">
              <RefreshCw size={28} className="animate-spin text-sky-500" />
              <p className="text-sm">{phase === 'sending' ? `Import en cours… (${news.length})` : 'Connexion à go&assist…'}</p>
            </div>
          )}

          {phase === 'preview' && preview && !loading && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface-2 border rounded-xl p-3">
                  <p className="text-ink-muted text-xs uppercase tracking-wider">Actionnable</p>
                  <p className="text-ink text-2xl font-bold">{preview.awaiting}</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                  <p className="text-amber-600 text-xs uppercase tracking-wider font-semibold">À valider</p>
                  <p className="text-amber-600 text-2xl font-bold">{preview.news}</p>
                </div>
                <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3">
                  <p className="text-sky-600 text-xs uppercase tracking-wider font-semibold">Nouvelles</p>
                  <p className="text-sky-600 text-2xl font-bold">{news.length}</p>
                </div>
              </div>

              {news.length > 0 && (
                <div className="space-y-1.5">
                  {news.map(m => {
                    const isNew = m.axaStatus === 'New'
                    return (
                      <div key={m.missionOrderId} className="bg-surface-2 border rounded-xl p-3">
                        <p className="text-ink font-mono text-sm font-semibold">{m.plate || m.missionOrderId}
                          <span className="ml-2 text-xs px-2 py-0.5 rounded bg-sky-500/15 text-sky-600">{m.mission_type}</span>
                          <span className={`ml-1.5 text-xs px-2 py-0.5 rounded ${isNew ? 'bg-amber-500/15 text-amber-600' : 'bg-success/15 text-success'}`}>
                            {isNew ? 'à valider' : 'validée AXA'}
                          </span>
                        </p>
                        <p className="text-ink-muted text-xs">{m.client_name || '—'} · {m.incident_city || '—'} · dossier {m.caseId}</p>
                      </div>
                    )
                  })}
                </div>
              )}
              {olds.length > 0 && (
                <details className="text-sm">
                  <summary className="text-ink-muted cursor-pointer">Déjà importées ({olds.length})</summary>
                  <div className="mt-2 space-y-1">
                    {olds.map(m => <p key={m.missionOrderId} className="text-ink-faint text-xs font-mono pl-3">✓ {m.plate || m.missionOrderId}</p>)}
                  </div>
                </details>
              )}
              {news.length === 0 && (
                <div className="bg-success-soft border border-success/30 rounded-xl p-4 text-center text-success">
                  <p className="font-semibold">Tout est à jour 🎉</p>
                </div>
              )}
            </>
          )}

          {phase === 'done' && sent && !loading && (
            <div className="bg-success-soft border-2 border-success/30 rounded-xl p-4 text-center">
              <CheckCircle2 size={32} className="mx-auto text-success mb-2" />
              <p className="text-success font-bold">Import terminé</p>
              <p className="text-ink-secondary text-sm mt-1">
                <strong>{sent.imported}</strong> créée{sent.imported > 1 ? 's' : ''}
                {sent.skipped > 0 && <> · {sent.skipped} sautée{sent.skipped > 1 ? 's' : ''}</>}
              </p>
              {sent.errors.length > 0 && (
                <div className="mt-2 text-left text-xs text-critical/80 space-y-0.5">
                  {sent.errors.map((e, i) => <p key={i}>⚠️ {e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-surface-2 flex items-center justify-end gap-2">
          {phase === 'preview' && preview && !loading && news.length > 0 && (
            <>
              <button onClick={close} className="px-3 py-2 text-ink-secondary hover:text-ink text-sm transition">Annuler</button>
              <button onClick={triggerSend} className="px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:opacity-90 text-white rounded-xl font-semibold text-sm transition">
                🅰️ Importer ({news.length})
              </button>
            </>
          )}
          {(phase === 'done' || (phase === 'preview' && preview && news.length === 0 && !loading)) && (
            <button onClick={close} className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl font-semibold text-sm transition">Fermer</button>
          )}
          {loading && <p className="text-ink-faint text-xs">⏳ Patiente…</p>}
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button onClick={openAndPreview} title="Récupérer les missions AXA à affecter"
        className="flex items-center justify-center gap-1.5 w-10 h-10 lg:w-auto lg:h-auto lg:px-3 lg:py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition flex-shrink-0">
        <span>🅰️</span>
        <span className="hidden lg:inline">Import AXA</span>
      </button>
      {modal}
    </>
  )
}

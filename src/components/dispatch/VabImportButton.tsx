'use client'

// src/components/dispatch/VabImportButton.tsx
//
// Bouton "Import VAB" dans la sticky bar /dispatch. Au clic :
// 1. Appel preview → modal affiche missions VAB visibles + flag existantes
// 2. User clique "Déclencher l'envoi" → appel send → emails partent
// 3. Les emails arrivent dans la boite -> parser existant -> nouvelles missions visibles dans /dispatch

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'

interface PreviewItem {
  missionNumber:   string
  detailHref:      string | null
  status:          string | null
  plate:           string | null
  fromLocation:    string | null
  toLocation:      string | null
  alreadyImported: boolean
}

interface PreviewResponse {
  ok:    boolean
  mode:  'preview'
  total: number
  new:   number
  items: PreviewItem[]
  debug?: string
}

interface SendResponse {
  ok:    boolean
  mode:  'send'
  total:     number
  already:   number
  attempted: number
  success:   number
  failed:    number
  results: Array<{ missionNumber: string; ok: boolean; error?: string }>
}

interface Props {
  /** Appele apres un envoi reussi pour reloader la liste dispatch (les emails arrivent en async, mais on refresh quand meme). */
  onImportDone?: () => void
}

export default function VabImportButton({ onImportDone }: Props) {
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [phase,   setPhase]   = useState<'preview' | 'sending' | 'done'>('preview')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [send,    setSend]    = useState<SendResponse | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function openAndPreview() {
    setOpen(true)
    setPhase('preview')
    setPreview(null)
    setSend(null)
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/vab/import?mode=preview', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setPreview(j)
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function triggerSend() {
    setPhase('sending')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/vab/import?mode=send', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setSend(j)
      setPhase('done')
      onImportDone?.()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
      setPhase('preview')
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setOpen(false)
    setPreview(null)
    setSend(null)
    setError(null)
  }

  const newMissions = preview?.items.filter(i => !i.alreadyImported) || []
  const existingMissions = preview?.items.filter(i => i.alreadyImported) || []

  // Lock scroll body quand modal ouvert
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Le modal est portail au niveau document.body pour echapper aux stacking
  // contexts parents (sticky header avec backdrop-blur qui creerait un
  // containing block pour position: fixed sinon).
  const modal = open && typeof window !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={!loading ? close : undefined}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border-2 border-amber-500/30 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
      >
            {/* Bande accent top */}
            <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />

            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between bg-amber-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-xl">
                  📨
                </div>
                <div>
                  <h2 className="text-ink font-bold">Import VAB</h2>
                  <p className="text-ink-muted text-xs">comet.vab.be → ton boîte mail</p>
                </div>
              </div>
              <button onClick={close} disabled={loading} className="text-ink-muted hover:text-critical disabled:opacity-30 p-1.5">
                <X size={20} />
              </button>
            </div>

            {/* Body scroll */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {error && (
                <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm">
                  <p className="font-semibold mb-0.5">⚠ {error}</p>
                </div>
              )}

              {loading && phase === 'preview' && !preview && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-ink-muted">
                  <RefreshCw size={28} className="animate-spin text-amber-500" />
                  <p className="text-sm">Connexion à VAB…</p>
                </div>
              )}

              {loading && phase === 'sending' && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-ink-muted">
                  <RefreshCw size={28} className="animate-spin text-amber-500" />
                  <p className="text-sm">Envoi en cours… ({newMissions.length} mission{newMissions.length > 1 ? 's' : ''})</p>
                </div>
              )}

              {/* PHASE PREVIEW */}
              {phase === 'preview' && preview && !loading && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-2 border rounded-xl p-3">
                      <p className="text-ink-muted text-xs uppercase tracking-wider">Total visible</p>
                      <p className="text-ink text-2xl font-bold">{preview.total}</p>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                      <p className="text-amber-600 text-xs uppercase tracking-wider font-semibold">À importer</p>
                      <p className="text-amber-600 text-2xl font-bold">{preview.new}</p>
                    </div>
                  </div>

                  {newMissions.length > 0 && (
                    <div>
                      <p className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-2">Nouvelles missions</p>
                      <div className="space-y-1.5">
                        {newMissions.map(m => (
                          <div key={m.missionNumber} className="bg-surface-2 border rounded-xl p-3 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-ink font-mono text-sm font-semibold">{m.missionNumber}</p>
                              <p className="text-ink-muted text-xs">
                                {m.plate ? `${m.plate} · ` : ''}{m.fromLocation || '—'} → {m.toLocation || '—'}
                              </p>
                            </div>
                            {m.status && (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 flex-shrink-0">
                                {m.status}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {existingMissions.length > 0 && (
                    <details className="text-sm">
                      <summary className="text-ink-muted cursor-pointer">
                        Déjà importées ({existingMissions.length})
                      </summary>
                      <div className="mt-2 space-y-1">
                        {existingMissions.map(m => (
                          <p key={m.missionNumber} className="text-ink-faint text-xs font-mono pl-3">
                            ✓ {m.missionNumber}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}

                  {preview.new === 0 && preview.total > 0 && (
                    <div className="bg-success-soft border border-success/30 rounded-xl p-4 text-center text-success">
                      <p className="font-semibold">Tout est à jour 🎉</p>
                      <p className="text-xs mt-1 opacity-80">Aucune nouvelle mission VAB à importer.</p>
                    </div>
                  )}
                  {preview.total === 0 && (
                    <div className="bg-warning-soft border border-warning/30 rounded-xl p-4 text-center">
                      <p className="text-warning font-semibold">Aucune mission détectée sur VAB</p>
                      <p className="text-ink-secondary text-xs mt-1">
                        Si VAB a bien des missions visibles, c'est un problème de parsing.
                      </p>
                      {preview.debug && (
                        <details className="mt-3 text-left">
                          <summary className="cursor-pointer text-ink-muted text-xs">Détails techniques</summary>
                          <code className="block mt-1 text-[10px] text-ink-faint bg-surface-2 p-2 rounded break-all">
                            {preview.debug}
                          </code>
                        </details>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* PHASE DONE */}
              {phase === 'done' && send && !loading && (
                <>
                  <div className="bg-success-soft border-2 border-success/30 rounded-xl p-4 text-center">
                    <CheckCircle2 size={32} className="mx-auto text-success mb-2" />
                    <p className="text-success font-bold">Envoi terminé</p>
                    <p className="text-ink-secondary text-sm mt-1">
                      {send.success}/{send.attempted} mission{send.attempted > 1 ? 's' : ''} envoyée{send.success > 1 ? 's' : ''}
                    </p>
                    <p className="text-ink-faint text-xs mt-2">
                      Les emails vont arriver dans la boîte et créeront automatiquement les missions dans /dispatch.
                    </p>
                  </div>

                  {send.failed > 0 && (
                    <div className="bg-critical-soft border border-critical/30 rounded-xl p-3">
                      <p className="text-critical text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <AlertCircle size={14} /> {send.failed} échec{send.failed > 1 ? 's' : ''}
                      </p>
                      <div className="space-y-1 text-xs">
                        {send.results.filter(r => !r.ok).map(r => (
                          <p key={r.missionNumber} className="text-critical/80">
                            <span className="font-mono">{r.missionNumber}</span> — {r.error}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t bg-surface-2 flex items-center justify-end gap-2">
              {phase === 'preview' && preview && !loading && preview.new > 0 && (
                <>
                  <button onClick={close} className="px-3 py-2 text-ink-secondary hover:text-ink text-sm transition">
                    Annuler
                  </button>
                  <button
                    onClick={triggerSend}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 text-white rounded-xl font-semibold text-sm transition"
                  >
                    📨 Déclencher l'envoi ({preview.new})
                  </button>
                </>
              )}
              {(phase === 'done' || (phase === 'preview' && preview?.new === 0)) && (
                <button
                  onClick={close}
                  className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl font-semibold text-sm transition"
                >
                  Fermer
                </button>
              )}
              {loading && (
                <p className="text-ink-faint text-xs">⏳ Patiente…</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null

  return (
    <>
      <button
        onClick={openAndPreview}
        title="Récupérer les missions VAB en attente"
        className="flex items-center justify-center gap-1.5 w-10 h-10 lg:w-auto lg:h-auto lg:px-3 lg:py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition flex-shrink-0"
      >
        <span>📨</span>
        <span className="hidden lg:inline">Import VAB</span>
      </button>
      {modal}
    </>
  )
}

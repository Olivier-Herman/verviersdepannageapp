'use client'

// src/components/dispatch/TouringImportButton.tsx
//
// Bouton « Import Touring » dans la sticky bar /dispatch (superadmin, phase de
// validation COMEX). Au clic :
// 1. preview → modal : missions COMEX à valider (03) + flag déjà en base
// 2. « Déclencher l'import » → send → INSERT direct dans incoming_missions.
// L'import ne mute RIEN côté Touring (lecture COMEX + création fiches VD Soft).
// Calqué sur VabImportButton (couleur bleu Touring pour différencier de VAB).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, CheckCircle2 } from 'lucide-react'

interface ImportItem {
  dossier:      string
  plaque:       string
  action:       'created' | 'skipped' | 'would_create' | 'failed'
  external_id?: string
  reason?:      string
  error?:       string
}

interface ImportResult {
  ok:       boolean
  mode:     'preview' | 'send'
  total:    number   // missions COMEX visibles
  aValider: number   // statut 03
  created:  number
  skipped:  number
  failed:   number
  results:  ImportItem[]
}

interface Props {
  /** Rappelé après un import réussi pour recharger la liste dispatch. */
  onImportDone?: () => void
}

export default function TouringImportButton({ onImportDone }: Props) {
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [phase,   setPhase]   = useState<'preview' | 'sending' | 'done'>('preview')
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [send,    setSend]    = useState<ImportResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function openAndPreview() {
    setOpen(true)
    setPhase('preview')
    setPreview(null)
    setSend(null)
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/touring/import?mode=preview', { method: 'POST' })
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
      const res = await fetch('/api/touring/import?mode=send', { method: 'POST' })
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

  const newMissions      = preview?.results.filter(i => i.action === 'would_create') || []
  const existingMissions = preview?.results.filter(i => i.action === 'skipped') || []
  const newCount = newMissions.length

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const modal = open && typeof window !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={!loading ? close : undefined}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border-2 border-sky-500/30 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
      >
            {/* Bande accent top */}
            <div className="h-1.5 bg-gradient-to-r from-sky-500 to-blue-600" />

            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between bg-sky-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-xl">
                  🚗
                </div>
                <div>
                  <h2 className="text-ink font-bold">Import Touring</h2>
                  <p className="text-ink-muted text-xs">plateforme COMEX → dispatch (sans mail, 0 IA)</p>
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
                  <RefreshCw size={28} className="animate-spin text-sky-500" />
                  <p className="text-sm">Connexion à COMEX…</p>
                </div>
              )}

              {loading && phase === 'sending' && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-ink-muted">
                  <RefreshCw size={28} className="animate-spin text-sky-500" />
                  <p className="text-sm">Import en cours… ({newCount} mission{newCount > 1 ? 's' : ''})</p>
                </div>
              )}

              {/* PHASE PREVIEW */}
              {phase === 'preview' && preview && !loading && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-surface-2 border rounded-xl p-3">
                      <p className="text-ink-muted text-xs uppercase tracking-wider">Visibles</p>
                      <p className="text-ink text-2xl font-bold">{preview.total}</p>
                    </div>
                    <div className="bg-surface-2 border rounded-xl p-3">
                      <p className="text-ink-muted text-xs uppercase tracking-wider">À valider</p>
                      <p className="text-ink text-2xl font-bold">{preview.aValider}</p>
                    </div>
                    <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3">
                      <p className="text-sky-600 text-xs uppercase tracking-wider font-semibold">À importer</p>
                      <p className="text-sky-600 text-2xl font-bold">{newCount}</p>
                    </div>
                  </div>

                  {newMissions.length > 0 && (
                    <div>
                      <p className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-2">Nouvelles missions</p>
                      <div className="space-y-1.5">
                        {newMissions.map(m => (
                          <div key={m.external_id || m.dossier} className="bg-surface-2 border rounded-xl p-3 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-ink font-mono text-sm font-semibold">{m.dossier}</p>
                              <p className="text-ink-muted text-xs">
                                {m.plaque ? `${m.plaque}` : '—'}{m.external_id ? ` · ${m.external_id}` : ''}
                              </p>
                            </div>
                            <span className="text-xs px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 flex-shrink-0">
                              à valider
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {existingMissions.length > 0 && (
                    <details className="text-sm">
                      <summary className="text-ink-muted cursor-pointer">
                        Déjà en base ({existingMissions.length})
                      </summary>
                      <div className="mt-2 space-y-1">
                        {existingMissions.map(m => (
                          <p key={m.external_id || m.dossier} className="text-ink-faint text-xs font-mono pl-3">
                            ✓ {m.dossier}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}

                  {newCount === 0 && preview.aValider > 0 && (
                    <div className="bg-success-soft border border-success/30 rounded-xl p-4 text-center text-success">
                      <p className="font-semibold">Tout est à jour 🎉</p>
                      <p className="text-xs mt-1 opacity-80">Les missions à valider sont déjà dans le dispatch.</p>
                    </div>
                  )}
                  {preview.aValider === 0 && (
                    <div className="bg-warning-soft border border-warning/30 rounded-xl p-4 text-center">
                      <p className="text-warning font-semibold">Aucune mission Touring à valider</p>
                      <p className="text-ink-secondary text-xs mt-1">
                        COMEX ne montre aucune mission au statut « à valider » (03) pour l'instant.
                        {preview.total > 0 && ` (${preview.total} mission(s) à un autre statut.)`}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* PHASE DONE */}
              {phase === 'done' && send && !loading && (
                <>
                  <div className="bg-success-soft border-2 border-success/30 rounded-xl p-4 text-center">
                    <CheckCircle2 size={32} className="mx-auto text-success mb-2" />
                    <p className="text-success font-bold">Import terminé</p>
                    <p className="text-ink-secondary text-sm mt-1">
                      <strong>{send.created}</strong> créée{send.created > 1 ? 's' : ''} dans le dispatch
                      {send.skipped > 0 && <> · {send.skipped} déjà en base</>}
                      {send.failed > 0 && <> · {send.failed} échec{send.failed > 1 ? 's' : ''}</>}
                    </p>
                    <p className="text-ink-faint text-xs mt-2">
                      Les missions créées sont visibles dans /dispatch (onglet « En attente »).
                    </p>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {send.results.map(r => {
                      const meta = r.action === 'created' ? { icon: '✅', cls: 'text-success', txt: 'créée dans le dispatch' }
                        : r.action === 'skipped' ? { icon: '⏭️', cls: 'text-ink-muted', txt: r.reason || 'déjà en base' }
                        :                           { icon: '⚠️', cls: 'text-critical/80', txt: r.error || 'échec' }
                      return (
                        <div key={r.external_id || r.dossier} className="flex items-start gap-2 bg-surface-2 border rounded-lg px-2.5 py-1.5">
                          <span>{meta.icon}</span>
                          <span className="min-w-0">
                            <span className="font-mono text-ink">{r.dossier}</span>
                            <span className={`ml-1.5 ${meta.cls}`}>— {meta.txt}</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t bg-surface-2 flex items-center justify-end gap-2">
              {phase === 'preview' && preview && !loading && newCount > 0 && (
                <>
                  <button onClick={close} className="px-3 py-2 text-ink-secondary hover:text-ink text-sm transition">
                    Annuler
                  </button>
                  <button
                    onClick={triggerSend}
                    className="px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:opacity-90 text-white rounded-xl font-semibold text-sm transition"
                  >
                    🚗 Déclencher l'import ({newCount})
                  </button>
                </>
              )}
              {(phase === 'done' || (phase === 'preview' && newCount === 0)) && (
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
        title="Récupérer les missions Touring à valider depuis COMEX"
        className="flex items-center justify-center gap-1.5 w-10 h-10 lg:w-auto lg:h-auto lg:px-3 lg:py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-medium transition flex-shrink-0"
      >
        <span>🚗</span>
        <span className="hidden lg:inline">Import Touring</span>
      </button>
      {modal}
    </>
  )
}

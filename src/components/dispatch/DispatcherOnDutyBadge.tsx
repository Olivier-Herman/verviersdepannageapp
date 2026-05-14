'use client'
// src/components/dispatch/DispatcherOnDutyBadge.tsx
//
// Badge "Dispatcher de garde : [Nom]" affiche dans la sticky bar /dispatch.
// Au clic (si role autorise), ouvre un modal pour choisir parmi les
// dispatchers/admins actifs. Utilise pour cibler les escalades auto-dispatch.

import { useEffect, useState } from 'react'
import { createPortal }        from 'react-dom'
import { Shield, X, Check }    from 'lucide-react'

interface DutyState {
  user_id:     string | null
  name:        string | null
  set_at:      string | null
  set_by_name: string | null
}

interface Candidate {
  id:   string
  name: string
  role: string
}

export default function DispatcherOnDutyBadge({ userRole }: { userRole: string }) {
  const canEdit = ['admin', 'superadmin', 'dispatcher'].includes(userRole)
  const [state, setState]       = useState<DutyState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)

  useEffect(() => { load() }, [])
  async function load() {
    try {
      const r = await fetch('/api/dispatcher-on-duty')
      if (r.ok) setState(await r.json())
    } catch { /* ignore */ }
  }

  async function openModal() {
    if (!canEdit) return
    setModalOpen(true)
    setLoading(true)
    try {
      const r = await fetch('/api/admin/users')
      const raw = await r.json()
      const all: Array<any> = Array.isArray(raw) ? raw : (raw.users || [])
      const filtered = all.filter(u =>
        u.active && ['dispatcher', 'admin', 'superadmin'].includes(u.role)
      ).map(u => ({ id: u.id, name: u.name, role: u.role }))
      setCandidates(filtered)
    } catch {
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }

  async function pick(userId: string | null) {
    setSaving(true)
    try {
      await fetch('/api/dispatcher-on-duty', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: userId }),
      })
      await load()
      setModalOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const labelText = state?.name
    ? `🛡️ Garde · ${state.name}`
    : '🛡️ Garde · personne'
  const colorClass = state?.name
    ? 'bg-success-soft border-success text-success'
    : 'bg-warning-soft border-warning text-warning'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={!canEdit}
        title={canEdit
          ? 'Cliquer pour changer le dispatcher de garde'
          : `Dispatcher de garde : ${state?.name || 'aucun'}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-medium transition ${colorClass} ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
      >
        <Shield size={12} />
        {labelText}
      </button>

      {modalOpen && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
             onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-surface border rounded-2xl max-w-md w-full p-5 space-y-3"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-ink font-semibold flex items-center gap-2">
                <Shield size={16} className="text-brand" /> Dispatcher de garde
              </h3>
              <button onClick={() => setModalOpen(false)} disabled={saving}
                className="text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>
            <p className="text-ink-muted text-xs">
              Le dispatcher de garde reçoit les escalades auto-dispatch (chauffeur sans réponse, appels police).
            </p>

            {loading ? (
              <p className="text-ink-muted text-sm text-center py-6">⏳ Chargement…</p>
            ) : candidates.length === 0 ? (
              <p className="text-ink-muted text-sm text-center py-6">Aucun dispatcher actif trouvé.</p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {candidates.map(u => {
                  const isCurrent = u.id === state?.user_id
                  return (
                    <button key={u.id} type="button"
                      disabled={saving}
                      onClick={() => pick(u.id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-xl text-left transition ${
                        isCurrent
                          ? 'bg-success-soft border-success'
                          : 'bg-surface-2 border hover:bg-surface-hover'
                      }`}>
                      <div>
                        <p className="text-ink text-sm font-medium">{u.name}</p>
                        <p className="text-ink-muted text-xs capitalize">{u.role}</p>
                      </div>
                      {isCurrent && <Check size={16} className="text-success" />}
                    </button>
                  )
                })}
              </div>
            )}

            {state?.user_id && (
              <button type="button"
                disabled={saving}
                onClick={() => pick(null)}
                className="w-full px-3 py-2 bg-critical-soft hover:bg-critical/20 border border-critical/30 text-critical rounded-xl text-xs transition disabled:opacity-50">
                ✕ Retirer (aucun dispatcher de garde)
              </button>
            )}

            {state?.set_by_name && state?.set_at && (
              <p className="text-ink-faint text-xs text-center pt-1">
                Modifié par {state.set_by_name} le {new Date(state.set_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

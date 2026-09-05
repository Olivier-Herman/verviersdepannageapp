'use client'
// src/components/notifications/BlockingNotificationModal.tsx
//
// POPUP BLOQUANT pour les notifications qui exigent une réponse (payload.data.modal).
// Impossible à rater : plein écran, au-dessus de tout, pas de ✕, pas de
// fermeture au clic-fond, reste tant que chaque question n'a pas sa réponse.
// Type géré : `verification_parc` → un choix Présent / Absent par véhicule.
// Olivier 2026-09-03.

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Item { mission_id: string; plate: string; vehicle: string; days: number; zone?: string | null; context?: string | null }
interface NotifEvent {
  id: string; notif_type: string
  payload: { title: string; body: string; action_url?: string; data?: Record<string, any> } | null
}

export default function BlockingNotificationModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  if (notif.notif_type === 'expert_access') return <ExpertAccessModal notif={notif} onDone={onDone} />
  return <ParcVerificationModal notif={notif} onDone={onDone} />
}

// ── Accès expert : Valider / Refuser (le premier qui répond décide) ──────────
function ExpertAccessModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  const d = notif.payload?.data || {}
  const [sending, setSending] = useState<'approve' | 'refuse' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function decide(decision: 'approve' | 'refuse') {
    setSending(decision); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(null) }
  }
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white border-4 border-blue-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-blue-700 text-white px-5 py-4 flex items-center gap-3">
          <span className="text-3xl">🪪</span>
          <div>
            <p className="text-lg font-bold leading-tight">Accès expert à valider</p>
            <p className="text-sm opacity-90">Le premier qui répond décide ; le popup se ferme chez les autres.</p>
          </div>
        </div>
        <div className="px-5 py-5 space-y-2">
          <p className="text-2xl font-black text-slate-900">{d.first_name || '—'}</p>
          <p className="text-slate-800">demande l'accès au parc pour <b>{d.bureau || '—'}</b>.</p>
          {Array.isArray(d.already) && d.already.length > 0 && <p className="text-sm text-slate-600">Déjà validé pour : {d.already.join(', ')}.</p>}
          <p className="text-xs text-slate-500">Il vient de scanner le QR de l'accueil : vérifie qu'il est bien devant toi ou attendu. Une fois validé, son téléphone garde l'accès (révocable dans Fourrière → Experts).</p>
          {err && <p className="text-red-600 text-sm">⚠ {err}</p>}
        </div>
        <div className="px-5 py-4 border-t bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" disabled={!!sending} onClick={() => decide('refuse')} className="px-5 py-2.5 rounded-xl bg-white border-2 border-red-500 text-red-700 hover:bg-red-50 disabled:opacity-40 font-bold">{sending === 'refuse' ? '…' : '✕ Refuser'}</button>
          <button type="button" disabled={!!sending} onClick={() => decide('approve')} className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold">{sending === 'approve' ? 'Envoi…' : '✓ Valider l\'accès'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Vérification parc : Présent / Absent par véhicule ─────────────────────────
function ParcVerificationModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  const items: Item[] = notif.payload?.data?.items || []
  const [answers, setAnswers] = useState<Record<string, 'present' | 'absent'>>({})
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const complete = items.length > 0 && items.every(it => answers[it.mission_id])

  async function submit() {
    setSending(true); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-white border-4 border-red-600 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-red-600 text-white px-5 py-4 flex items-center gap-3">
          <AlertTriangle size={28} />
          <div>
            <p className="text-lg font-bold leading-tight">{notif.payload?.title || 'Vérification demandée'}</p>
            <p className="text-sm opacity-90">Réponse obligatoire — ce message reste affiché tant que tout n'est pas vérifié.</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {notif.payload?.body && <p className="text-slate-800 text-sm">{notif.payload.body}</p>}
          <div className="space-y-2">
            {items.map(it => {
              const a = answers[it.mission_id]
              return (
                <div key={it.mission_id} className={`rounded-xl border-2 px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${a === 'present' ? 'border-green-500 bg-green-50' : a === 'absent' ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50'}`}>
                  <div className="min-w-0">
                    <div className="font-mono text-xl font-bold text-slate-900">{it.plate}</div>
                    <div className="text-sm text-slate-700">{it.vehicle} · en parc depuis <b>{it.days} j</b>{it.zone ? ` · ${it.zone}` : ''}</div>
                    {it.context && <div className="text-xs text-slate-500 mt-0.5">{it.context}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => setAnswers(p => ({ ...p, [it.mission_id]: 'present' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-bold border-2 ${a === 'present' ? 'bg-green-600 border-green-700 text-white' : 'bg-white border-green-500 text-green-700 hover:bg-green-50'}`}>
                      ✓ Présent
                    </button>
                    <button type="button" onClick={() => setAnswers(p => ({ ...p, [it.mission_id]: 'absent' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-bold border-2 ${a === 'absent' ? 'bg-red-600 border-red-700 text-white' : 'bg-white border-red-500 text-red-700 hover:bg-red-50'}`}>
                      ✕ Absent
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {err && <p className="text-red-600 text-sm">⚠ {err}</p>}
        </div>
        <div className="px-5 py-4 border-t bg-slate-50 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{Object.keys(answers).length}/{items.length} vérifié(s)</span>
          <button type="button" disabled={!complete || sending} onClick={submit}
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold">
            {sending ? 'Envoi…' : 'Valider la vérification'}
          </button>
        </div>
      </div>
    </div>
  )
}

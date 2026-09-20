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
  if (notif.notif_type === 'siabis_couvert_request') return <SiabisCouvertModal notif={notif} onDone={onDone} />
  return <ParcVerificationModal notif={notif} onDone={onDone} />
}

// ── Siabis couvert sur demande chauffeur : Confirmer / Refuser (Olivier 20/09/2026) ──
// Sans mission reçue de l'assistance, la facture sera refusée → on perd. Le premier qui répond décide.
function SiabisCouvertModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  const d = notif.payload?.data || {}
  const candidates: { mission_number: number; source: string; status: string; received_at: string }[] = d.candidates || []
  const [sending, setSending] = useState<null | 'approve' | 'refuse'>(null)
  const [err, setErr] = useState<string | null>(null)
  async function decide(decision: 'approve' | 'refuse') {
    setSending(decision); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siabis_decision: decision }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(null) }
  }
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white border-4 border-amber-500 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-amber-500 text-white px-5 py-4 flex items-center gap-3">
          <span className="text-3xl">🛣️</span>
          <div>
            <p className="text-lg font-bold leading-tight">Passage en Siabis COUVERT demandé</p>
            <p className="text-sm opacity-90">Réponse obligatoire — le premier qui répond décide.</p>
          </div>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-slate-900"><b>{d.driver_name || 'Un chauffeur'}</b> demande de passer la fiche <b>#{d.mission_number}</b> en couvert.</p>
          <div className="rounded-xl bg-slate-50 border px-4 py-3">
            <div className="font-mono text-2xl font-bold text-slate-900">{d.plate || 'sans plaque'}</div>
            <div className="text-sm text-slate-700">{d.vehicle}{d.city ? ` · ${d.city}` : ''}{d.origin_source ? ` · reçue via ${String(d.origin_source).toUpperCase()}` : ''}</div>
          </div>
          <div className="rounded-xl border px-4 py-3 text-sm">
            <p className="font-semibold text-slate-900 mb-1">Missions reçues d'une assistance pour cette plaque (24 h) :</p>
            {candidates.length === 0
              ? <p className="text-red-700 font-semibold">Aucune. Sans mission reçue, l'assistance refusera la facture.</p>
              : <ul className="space-y-1">{candidates.map(c => <li key={c.mission_number} className="text-slate-800">#{c.mission_number} · {String(c.source).toUpperCase()} · {c.status} · {new Date(c.received_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</li>)}</ul>}
          </div>
          <p className="text-xs text-slate-500">Confirmer = facturé à l'assistance, plus d'encaissement client. Refuser = reste non couvert, le client paie sur place et se fait rembourser.</p>
          {err && <p className="text-red-600 text-sm">⚠ {err}</p>}
        </div>
        <div className="px-5 py-4 border-t bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" disabled={!!sending} onClick={() => decide('refuse')} className="px-4 py-2.5 rounded-xl bg-white border-2 border-red-500 text-red-700 font-bold disabled:opacity-40">{sending === 'refuse' ? 'Envoi…' : '✕ Refuser (reste non couvert)'}</button>
          <button type="button" disabled={!!sending} onClick={() => decide('approve')} className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold disabled:opacity-40">{sending === 'approve' ? 'Envoi…' : '✓ Confirmer couvert'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Accès expert : Valider / Refuser (le premier qui répond décide) ──────────
function ExpertAccessModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  const d = notif.payload?.data || {}
  const items: { request_id: string; bureau: string }[] = d.items || []
  const [decisions, setDecisions] = useState<Record<string, 'approve' | 'refuse'>>({})
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const complete = items.length > 0 && items.every(it => decisions[it.request_id])
  const setAll = (v: 'approve' | 'refuse') => setDecisions(Object.fromEntries(items.map(it => [it.request_id, v])))
  async function submit() {
    setSending(true); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisions }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(false) }
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
          <p className="text-slate-800">demande l'accès au parc pour {items.length > 1 ? 'ces bureaux' : 'ce bureau'} :</p>
          <div className="space-y-2">
            {items.map(it => {
              const a = decisions[it.request_id]
              return (
                <div key={it.request_id} className={`rounded-xl border-2 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap ${a === 'approve' ? 'border-green-500 bg-green-50' : a === 'refuse' ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50'}`}>
                  <span className="font-semibold text-slate-900">{it.bureau}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => setDecisions(p => ({ ...p, [it.request_id]: 'approve' }))} className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${a === 'approve' ? 'bg-green-600 border-green-700 text-white' : 'bg-white border-green-500 text-green-700 hover:bg-green-50'}`}>✓ Valider</button>
                    <button type="button" onClick={() => setDecisions(p => ({ ...p, [it.request_id]: 'refuse' }))} className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${a === 'refuse' ? 'bg-red-600 border-red-700 text-white' : 'bg-white border-red-500 text-red-700 hover:bg-red-50'}`}>✕ Refuser</button>
                  </div>
                </div>
              )
            })}
          </div>
          {items.length > 1 && <div className="flex gap-3 text-xs"><button type="button" onClick={() => setAll('approve')} className="text-green-700 underline">Tout valider</button><button type="button" onClick={() => setAll('refuse')} className="text-red-700 underline">Tout refuser</button></div>}
          {Array.isArray(d.already) && d.already.length > 0 && <p className="text-sm text-slate-600">Déjà validé pour : {d.already.join(', ')}.</p>}
          <p className="text-xs text-slate-500">Il vient de scanner le QR de l'accueil : vérifie qu'il est bien devant toi ou attendu. Une fois validé, son téléphone garde l'accès (révocable dans Fourrière → Experts).</p>
          {err && <p className="text-red-600 text-sm">⚠ {err}</p>}
        </div>
        <div className="px-5 py-4 border-t bg-slate-50 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{Object.keys(decisions).length}/{items.length} décidé(s)</span>
          <button type="button" disabled={!complete || sending} onClick={submit} className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold">{sending ? 'Envoi…' : 'Confirmer'}</button>
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

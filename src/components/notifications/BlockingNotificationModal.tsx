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
import { useT } from '@/lib/i18n/I18nProvider'

interface Item { mission_id: string; plate: string; vehicle: string; days: number; zone?: string | null; context?: string | null }
interface NotifEvent {
  id: string; notif_type: string
  payload: { title: string; body: string; action_url?: string; data?: Record<string, any> } | null
}

export default function BlockingNotificationModal({ notif, onDone, onSnooze }: { notif: NotifEvent; onDone: () => void; onSnooze?: (minutes: number) => void }) {
  if (notif.notif_type === 'message_bloquant') return <MessageAckModal notif={notif} onDone={onDone} />
  if (notif.notif_type === 'expert_access') return <ExpertAccessModal notif={notif} onDone={onDone} />
  if (notif.notif_type === 'siabis_couvert_request') return <SiabisCouvertModal notif={notif} onDone={onDone} />
  if (notif.notif_type === 'mission_address_changed') return <AddressChangeModal notif={notif} onDone={onDone} />
  if (notif.notif_type === 'levee_saisie_alarme') return <LeveeAlarmModal notif={notif} onDone={onDone} onSnooze={onSnooze} />
  return <ParcVerificationModal notif={notif} onDone={onDone} />
}

// ── Adresse de livraison modifiée par l'assistance (Olivier 05/10/2026, 2DTV183) ──
// Dispatch : appliquer la nouvelle adresse ou garder l'actuelle (le premier qui répond décide).
// Chauffeur : ne pas livrer, appeler le dispatch (texte FR / albanais).
function AddressChangeModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  const { t } = useT()
  const d = notif.payload?.data || {}
  const driver = d.role === 'driver'
  const [sending, setSending] = useState<null | 'apply' | 'keep' | 'ack'>(null)
  const [err, setErr] = useState<string | null>(null)
  async function send(what: 'apply' | 'keep' | 'ack') {
    setSending(what); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(what === 'ack' ? { address_ack: true } : { address_decision: what }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(null) }
  }
  const newAddr = `${d.new_name ? d.new_name + ', ' : ''}${d.new_address || '—'}`
  const oldAddr = `${d.old_name ? d.old_name + ', ' : ''}${d.old_address || '—'}`
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white border-4 border-red-600 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-red-600 text-white px-5 py-4 flex items-center gap-3">
          <span className="text-3xl">📍</span>
          <div>
            <p className="text-lg font-bold leading-tight">{driver ? t('mission_detail.addr_change_title') : 'Nouvelle adresse de livraison reçue'}</p>
            <p className="text-sm opacity-90">{driver ? t('mission_detail.addr_change_body') : `${d.source || 'L’assistance'} a changé l’adresse — réponse obligatoire, le premier qui répond décide.`}</p>
          </div>
        </div>
        <div className="px-5 py-5 space-y-3">
          <div className="rounded-xl bg-slate-50 border px-4 py-3">
            <div className="font-mono text-2xl font-bold text-slate-900">{d.plate || 'sans plaque'}</div>
            <div className="text-sm text-slate-700">Fiche #{d.mission_number}{!driver && d.vehicle ? ` · ${d.vehicle}` : ''}{!driver && d.driver_name ? ` · chauffeur : ${d.driver_name}` : ''}</div>
          </div>
          <div className="rounded-xl border px-4 py-3 text-sm space-y-2">
            <p className="text-slate-700"><span className="font-semibold text-slate-900">{driver ? t('mission_detail.addr_change_current') : 'Adresse actuelle'} :</span> {oldAddr}</p>
            <p className="text-red-800"><span className="font-semibold">{driver ? t('mission_detail.addr_change_new') : 'Nouvelle adresse reçue'} :</span> {newAddr}</p>
            {!driver && d.ref && <p className="text-xs text-slate-500">Référence : {d.ref}</p>}
          </div>
          {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
          {driver ? (
            <button type="button" disabled={!!sending} onClick={() => send('ack')} className="w-full min-h-[52px] rounded-xl bg-red-600 text-white font-bold">{sending ? '…' : t('mission_detail.addr_change_ok')}</button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={!!sending} onClick={() => send('apply')} className="min-h-[52px] rounded-xl bg-red-600 text-white font-bold px-3">{sending === 'apply' ? '…' : 'Appliquer la nouvelle adresse'}</button>
              <button type="button" disabled={!!sending} onClick={() => send('keep')} className="min-h-[52px] rounded-xl border-2 border-slate-400 text-slate-900 font-bold px-3">{sending === 'keep' ? '…' : 'Garder l’adresse actuelle'}</button>
            </div>
          )}
          {!driver && <p className="text-xs text-slate-600">Le chauffeur est prévenu de ta décision. Pense à l’appeler s’il est déjà en route.</p>}
        </div>
      </div>
    </div>
  )
}

// ── Levée de saisie à vérifier (Olivier 06/10/2026) ──────────────────────────
// Cas anormal (2e levée du même type, définitive puis temporaire, date absente ou
// incohérente, plusieurs fiches) : les utilisateurs fourrière décident. Le premier qui
// décide ferme l'alarme pour tous ; la décision est notée sur la fiche.
// NON bloquante : encadré en bas d'écran, on peut continuer une facture ou un dossier,
// et « Me rappeler dans 15 min » le cache le temps de finir (Olivier 06/10/2026).
function LeveeAlarmModal({ notif, onDone, onSnooze }: { notif: NotifEvent; onDone: () => void; onSnooze?: (minutes: number) => void }) {
  const d = notif.payload?.data || {}
  const choices: { id: string; label: string }[] = d.choices || []
  const needDate = !d.levee_date
  const [pick, setPick] = useState<string>(choices.length ? '' : (d.fiche?.id || ''))
  const [date, setDate] = useState<string>(d.levee_date || '')
  const [sending, setSending] = useState<null | 'attach' | 'ignore'>(null)
  const [err, setErr] = useState<string | null>(null)
  async function send(action: 'attach' | 'ignore') {
    if (action === 'attach' && !pick) { setErr('Choisis la fiche.'); return }
    if (action === 'attach' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr('Indique la date de levée.'); return }
    setSending(action); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ levee_action: action, mission_id: pick || undefined, levee_date: date || undefined }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(null) }
  }
  const typeLabel = d.levee_type === 'temporaire' ? 'temporaire' : 'définitive'
  return (
    <div className="fixed z-[300] bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:w-[30rem] pointer-events-none">
      <div className="pointer-events-auto max-h-[75vh] overflow-y-auto rounded-2xl bg-white border-4 border-red-600 shadow-2xl">
        <div className="bg-red-600 text-white px-5 py-3 flex items-center gap-3">
          <span className="text-2xl">🔓</span>
          <div className="flex-1">
            <p className="text-base font-bold leading-tight">Levée de saisie à vérifier</p>
            <p className="text-xs opacity-90">Le premier qui décide ferme l’alarme pour tous.</p>
          </div>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-slate-900">{d.explanation}</p>
          <div className="rounded-xl bg-slate-50 border px-4 py-3 text-sm space-y-1">
            <p className="text-slate-800"><span className="font-semibold text-slate-900">Levée reçue :</span> {typeLabel}{d.levee_date ? ` · ${String(d.levee_date).split('-').reverse().join('/')}` : ' · date non lue'}</p>
            {d.subject && <p className="text-slate-700 break-words"><span className="font-semibold text-slate-900">Mail :</span> {d.subject}{d.from ? ` (${d.from})` : ''}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {d.doc_url && <a href={d.doc_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] px-3 rounded-lg border-2 border-slate-400 text-slate-900 font-semibold">📄 Document reçu</a>}
              {d.prev_doc_url && <a href={d.prev_doc_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] px-3 rounded-lg border-2 border-slate-400 text-slate-900 font-semibold">📄 Levée déjà enregistrée</a>}
              {(pick || d.fiche?.id) && <a href={`/dispatch/${pick || d.fiche.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] px-3 rounded-lg border-2 border-slate-400 text-slate-900 font-semibold">Ouvrir la fiche</a>}
            </div>
          </div>
          {choices.length > 0 && (
            <div className="rounded-xl border px-4 py-3 text-sm space-y-2">
              <p className="font-semibold text-slate-900">Choisir la fiche :</p>
              {choices.map(c => (
                <label key={c.id} className="flex items-center gap-3 min-h-[44px] text-slate-800">
                  <input type="radio" name="levee-fiche" checked={pick === c.id} onChange={() => setPick(c.id)} className="w-5 h-5" />
                  {c.label}
                </label>
              ))}
            </div>
          )}
          {needDate && (
            <label className="block text-sm text-slate-900">
              <span className="font-semibold">Date de levée (lue sur le document) :</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-lg border-2 border-slate-300 px-3 text-slate-900 bg-white" />
            </label>
          )}
          {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={!!sending} onClick={() => send('attach')} className="min-h-[52px] rounded-xl bg-red-600 text-white font-bold px-3">{sending === 'attach' ? '…' : d.reason?.startsWith('deuxième') || d.reason === 'temporaire après définitive' ? 'Rattacher quand même (remplace)' : 'Rattacher'}</button>
            <button type="button" disabled={!!sending} onClick={() => send('ignore')} className="min-h-[52px] rounded-xl border-2 border-slate-400 text-slate-900 font-bold px-3">{sending === 'ignore' ? '…' : 'Ignorer (doublon)'}</button>
          </div>
          {onSnooze && <button type="button" disabled={!!sending} onClick={() => onSnooze(15)} className="w-full min-h-[44px] rounded-xl bg-slate-100 text-slate-800 font-semibold">⏰ Me rappeler dans 15 min</button>}
          <p className="text-xs text-slate-600">« Rattacher » enregistre la levée sur la fiche (elle arrête le gardiennage à sa date). « Ignorer » classe le mail sans rien changer.</p>
        </div>
      </div>
    </div>
  )
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

// ── Message important : « J'ai lu ce message » obligatoire (Olivier 09/10/2026) ──
function MessageAckModal({ notif, onDone }: { notif: NotifEvent; onDone: () => void }) {
  const { t } = useT()
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function ack() {
    setSending(true); setErr(null)
    try {
      const r = await fetch(`/api/notifications/${notif.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_ack: true }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onDone()
    } catch { setErr('Erreur réseau') } finally { setSending(false) }
  }
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white border-4 border-red-600 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-red-600 text-white px-5 py-4 flex items-center gap-3">
          <AlertTriangle size={28} />
          <p className="text-lg font-bold leading-tight">{notif.payload?.title || t('mission_detail.message_ack_title')}</p>
        </div>
        <div className="px-5 py-5">
          <p className="text-slate-800 text-base whitespace-pre-line leading-relaxed">{notif.payload?.body}</p>
          {err && <p className="text-red-700 text-sm mt-3">⚠ {err}</p>}
        </div>
        <div className="px-5 py-4 border-t bg-slate-50">
          <button type="button" disabled={sending} onClick={ack} className="w-full min-h-[52px] rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-base disabled:opacity-60">{sending ? '…' : t('mission_detail.message_ack_button')}</button>
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

// src/lib/sumup-pending.ts
//
// PAIEMENT SUMUP EN ATTENTE D'ENREGISTREMENT (côté navigateur).
//
// Terminal / Tap to Pay : le chauffeur bascule dans l'app SumUp, encaisse, et
// revient dans VD Soft — mais la page du module d'encaissement n'a pas
// forcément survécu (WebView rechargée, retour SumUp sur une autre page). Le
// 08/09/2026 (2GNM127, Matthieu) : SumUp disait « payé », VD Soft n'avait rien,
// et la clôture redemandait le paiement.
//
// On mémorise donc, AVANT de partir dans SumUp, tout ce qu'il faut pour
// enregistrer l'encaissement sans l'assistant : au retour, n'importe quelle page
// (module d'encaissement, page de retour SumUp) retrouve ce brouillon, vérifie
// le paiement chez SumUp et l'enregistre.

export interface SumupPending {
  ref:        string          // référence VD… (titre de la transaction SumUp)
  amount:     number
  started_at: string
  return_to:  string | null
  payload:    Record<string, any>   // corps prêt pour POST /api/interventions (sans payment_mode)
}

const KEY = 'vd_sumup_pending'
const MAX_AGE_MS = 6 * 60 * 60 * 1000   // 6 h : au-delà, on ne devine plus

export function savePending(p: SumupPending) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* stockage indisponible */ }
}
export function loadPending(): SumupPending | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as SumupPending
    if (!p?.ref || !p?.payload) { localStorage.removeItem(KEY); return null }
    if (Date.now() - new Date(p.started_at).getTime() > MAX_AGE_MS) { localStorage.removeItem(KEY); return null }
    return p
  } catch { return null }
}
export function clearPending() {
  try { localStorage.removeItem(KEY) } catch { /* noop */ }
}

/** Le paiement est-il passé chez SumUp ? (transaction retrouvée par référence) */
export async function checkPaid(ref: string): Promise<'PAID' | 'PENDING' | 'FAILED'> {
  try {
    const r = await fetch(`/api/sumup?ref=${encodeURIComponent(ref)}`, { cache: 'no-store' })
    const j = await r.json()
    return j.status === 'PAID' ? 'PAID' : (j.status === 'FAILED' || j.status === 'EXPIRED') ? 'FAILED' : 'PENDING'
  } catch { return 'PENDING' }
}

/** Enregistre l'encaissement à partir du brouillon (mode SumUp, référence). */
export async function submitPending(p: SumupPending, note?: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch('/api/interventions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...p.payload,
      amount: String(p.amount),
      payment_mode: 'sumup',
      payment_reference: p.ref,
      notes: [p.payload?.notes, note].filter(Boolean).join(' · ') || undefined,
    }),
  })
  if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.error || `HTTP ${r.status}` } }
  clearPending()
  return { ok: true }
}

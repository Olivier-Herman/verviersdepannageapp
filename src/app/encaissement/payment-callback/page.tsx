'use client'
// src/app/encaissement/payment-callback/page.tsx
//
// Page de RETOUR SumUp (checkout en ligne : redirect_url ; app SumUp :
// paramètre callback du deep link). Avant le 08/09/2026 elle se contentait
// d'afficher « Paiement confirmé » et renvoyait au tableau de bord : rien
// n'était enregistré si l'assistant d'encaissement n'avait pas survécu au
// passage dans l'app SumUp (2GNM127, Matthieu). Désormais elle retrouve le
// brouillon mémorisé avant le départ, vérifie le paiement chez SumUp et
// ENREGISTRE l'encaissement, puis ramène à la mission.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { loadPending, checkPaid, submitPending, clearPending, type SumupPending } from '@/lib/sumup-pending'

type Status = 'loading' | 'recorded' | 'paid_unrecorded' | 'unverified' | 'failed' | 'error'

function PaymentCallbackContent() {
  const params = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [pending, setPending] = useState<SumupPending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const goBack = (p: SumupPending | null) => router.push(p?.return_to || '/dashboard')

  useEffect(() => {
    const checkoutId = params.get('checkout_id')
    const success = params.get('success')
    const smp = (params.get('smp-status') || '').toLowerCase()     // app SumUp : success | failed
    const refParam = params.get('ref')
    const p = loadPending()
    setPending(p)

    const saidOk = success === 'true' || success === '1' || smp === 'success'
    const saidKo = success === 'false' || success === '0' || smp === 'failed'

    ;(async () => {
      // 1. Un brouillon attend : on vérifie chez SumUp puis on ENREGISTRE.
      if (p && (!refParam || refParam === p.ref)) {
        const paid = await checkPaid(p.ref)
        if (paid === 'PAID' || saidOk) {
          const r = await submitPending(p, paid === 'PAID' ? 'Retour SumUp : transaction retrouvée' : 'Retour SumUp : succès annoncé par l\'app')
          if (r.ok) { setStatus('recorded'); setTimeout(() => goBack(p), 2500); return }
          setError(r.error || 'Enregistrement impossible'); setStatus('error'); return
        }
        // Refus / annulation : le brouillon ne doit pas resurgir en « paiement en
        // attente d'enregistrement » (validation manuelle d'un paiement raté).
        if (paid === 'FAILED' || saidKo) { clearPending(); setStatus('failed'); return }
        setStatus('unverified'); return
      }
      // 2. Pas de brouillon (checkout en ligne, ou page ouverte à froid).
      if (saidOk) { setStatus('paid_unrecorded'); return }
      if (saidKo) { setStatus('failed'); return }
      if (checkoutId) {
        try {
          const r = await fetch(`/api/sumup?checkoutId=${checkoutId}`); const j = await r.json()
          setStatus(j.status === 'PAID' ? 'paid_unrecorded' : 'failed')
        } catch { setStatus('failed') }
        return
      }
      setStatus('failed')
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function forceRecord() {
    if (!pending) return
    setBusy(true); setError(null)
    const r = await submitPending(pending, 'Retour SumUp : validé manuellement par le chauffeur')
    setBusy(false)
    if (r.ok) { setStatus('recorded'); setTimeout(() => goBack(pending), 2000) } else { setError(r.error || 'Erreur'); setStatus('error') }
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
      {status === 'loading' && (<>
        <div className="text-4xl mb-4 animate-pulse">⏳</div>
        <p className="text-white text-lg font-bold mb-2">Vérification du paiement chez SumUp…</p>
        <p className="text-zinc-500 text-sm">Merci de patienter</p>
      </>)}
      {status === 'recorded' && (<>
        <div className="text-6xl mb-6">✅</div>
        <p className="text-white text-2xl font-bold mb-2">Paiement enregistré</p>
        <p className="text-zinc-400 text-sm mb-1">{pending ? `${pending.amount.toFixed(2)} € · réf. ${pending.ref}` : ''}</p>
        <p className="text-zinc-500 text-sm mb-8">Retour à la mission…</p>
        <button onClick={() => goBack(pending)} className="text-brand text-sm">← Retour</button>
      </>)}
      {status === 'unverified' && pending && (<>
        <div className="text-6xl mb-6">🕐</div>
        <p className="text-white text-2xl font-bold mb-2">Paiement pas encore visible chez SumUp</p>
        <p className="text-zinc-400 text-sm mb-6">{pending.amount.toFixed(2)} € · réf. {pending.ref}. Si l'app SumUp a affiché « payé », enregistre-le : la référence sera vérifiée par le bureau.</p>
        <button disabled={busy} onClick={forceRecord} className="bg-brand text-white font-bold rounded-xl py-3 px-8 mb-3 disabled:opacity-50">{busy ? 'Enregistrement…' : '✅ Le paiement est fait — enregistrer'}</button>
        <button disabled={busy} onClick={async () => { setBusy(true); const s = await checkPaid(pending.ref); setBusy(false); if (s === 'PAID') forceRecord() }} className="text-zinc-300 text-sm mb-3">🔄 Revérifier chez SumUp</button>
        <button onClick={() => { clearPending(); goBack(pending) }} className="text-zinc-500 text-sm">Le paiement n'a pas eu lieu — abandonner</button>
      </>)}
      {status === 'paid_unrecorded' && (<>
        <div className="text-6xl mb-6">✅</div>
        <p className="text-white text-2xl font-bold mb-2">Paiement confirmé</p>
        <p className="text-zinc-400 text-sm mb-8">Retourne dans le module d'encaissement pour terminer l'enregistrement.</p>
        <Link href="/encaissement" className="bg-brand text-white font-bold rounded-xl py-3 px-8 mb-3">Ouvrir l'encaissement</Link>
        <Link href="/dashboard" className="text-zinc-500 text-sm">← Dashboard</Link>
      </>)}
      {status === 'failed' && (<>
        <div className="text-6xl mb-6">❌</div>
        <p className="text-white text-2xl font-bold mb-2">Paiement non complété</p>
        <p className="text-zinc-500 text-sm mb-8">Le paiement a été annulé ou refusé. Rien n'a été enregistré : choisis un autre moyen de paiement ou réessaie.</p>
        <button onClick={() => router.push(pending?.return_to || '/encaissement')} className="bg-brand text-white font-bold rounded-xl py-3 px-8 mb-3">Choisir un moyen de paiement</button>
        <Link href="/dashboard" className="text-zinc-500 text-sm">← Dashboard</Link>
      </>)}
      {status === 'error' && (<>
        <div className="text-6xl mb-6">⚠️</div>
        <p className="text-white text-2xl font-bold mb-2">Paiement reçu, enregistrement impossible</p>
        <p className="text-red-400 text-sm mb-6">{error}</p>
        <button disabled={busy} onClick={forceRecord} className="bg-brand text-white font-bold rounded-xl py-3 px-8 mb-3 disabled:opacity-50">Réessayer l'enregistrement</button>
        <p className="text-zinc-500 text-sm">Sinon, préviens le bureau : SumUp a bien la transaction.</p>
      </>)}
    </div>
  )
}

export default function PaymentCallback() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center"><p className="text-zinc-500">Chargement…</p></div>}>
      <PaymentCallbackContent />
    </Suspense>
  )
}

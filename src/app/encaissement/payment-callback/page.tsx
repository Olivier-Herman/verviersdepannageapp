'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

function PaymentCallbackContent() {
  const params = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'paid' | 'failed'>('loading')

  useEffect(() => {
    const checkoutId = params.get('checkout_id')
    const result = params.get('success')

    if (result === 'true' || result === '1') {
      setStatus('paid')
      setTimeout(() => router.push('/dashboard'), 4000)
    } else if (result === 'false' || result === '0') {
      setStatus('failed')
    } else if (checkoutId) {
      fetch(`/api/sumup?checkoutId=${checkoutId}`)
        .then(r => r.json())
        .then(data => {
          if (data.status === 'PAID') {
            setStatus('paid')
            setTimeout(() => router.push('/dashboard'), 4000)
          } else {
            setStatus('failed')
          }
        })
        .catch(() => setStatus('failed'))
    } else {
      setStatus('failed')
    }
  }, [])

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 text-center">
      {status === 'loading' && (
        <>
          <div className="text-4xl mb-4 animate-pulse">⏳</div>
          <p className="text-white text-lg font-bold mb-2">Vérification du paiement…</p>
          <p className="text-zinc-500 text-sm">Merci de patienter</p>
        </>
      )}
      {status === 'paid' && (
        <>
          <div className="text-6xl mb-6">✅</div>
          <p className="text-white text-2xl font-bold mb-2">Paiement confirmé !</p>
          <p className="text-zinc-500 text-sm mb-8">Redirection dans quelques secondes…</p>
          <Link href="/dashboard" className="text-brand text-sm">← Dashboard</Link>
        </>
      )}
      {status === 'failed' && (
        <>
          <div className="text-6xl mb-6">❌</div>
          <p className="text-white text-2xl font-bold mb-2">Paiement non complété</p>
          <p className="text-zinc-500 text-sm mb-8">Le paiement a été annulé ou refusé.</p>
          <button onClick={() => router.back()}
            className="bg-brand text-white font-bold rounded-xl py-3 px-8 mb-3">
            Réessayer
          </button>
          <Link href="/dashboard" className="text-zinc-500 text-sm">← Dashboard</Link>
        </>
      )}
    </div>
  )
}

export default function PaymentCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <p className="text-zinc-500">Chargement…</p>
      </div>
    }>
      <PaymentCallbackContent />
    </Suspense>
  )
}

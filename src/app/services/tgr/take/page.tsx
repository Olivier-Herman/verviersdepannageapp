'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter }       from 'next/navigation'
import AppShell            from '@/components/layout/AppShell'

function TGRTakeContent() {
  const params    = useSearchParams()
  const router    = useRouter()
  const missionId = params.get('missionId')
  const token     = params.get('token')
  const [status,  setStatus]  = useState<'confirm' | 'success' | 'taken' | 'error'>('confirm')
  const [message, setMessage] = useState('')
  const [taking,  setTaking]  = useState(false)

  const handleTake = async () => {
    setTaking(true)
    try {
      const res  = await fetch(`/api/tgr/${missionId}/take`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      })
      const data = await res.json()
      if (data.alreadyTaken) { setStatus('taken'); return }
      if (!res.ok) throw new Error(data.error)
      setStatus('success')
      setMessage(data.takenBy)
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setTaking(false)
    }
  }

  if (!missionId || !token) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-red-400">Lien invalide</p>
    </div>
  )

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 max-w-md mx-auto text-center gap-6">
      {status === 'confirm' && (
        <>
          <div className="text-6xl">🤝</div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Prendre cette mission ?</h2>
            <p className="text-zinc-400 text-sm">
              En confirmant, vous vous engagez à prendre en charge cette mission TGR.
              Le demandeur sera notifié immédiatement.
            </p>
          </div>
          <button onClick={handleTake} disabled={taking}
            className="w-full py-4 bg-green-700 hover:bg-green-600 text-white rounded-2xl font-bold text-lg disabled:opacity-50">
            {taking ? '⏳ En cours…' : '✅ Je prends la mission'}
          </button>
          <button onClick={() => router.push('/services/tgr')}
            className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 rounded-xl text-sm">
            Annuler
          </button>
        </>
      )}
      {status === 'success' && (
        <>
          <div className="text-7xl">✅</div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Mission prise en charge !</h2>
            <p className="text-zinc-400 text-sm">Le demandeur a été notifié. Prenez contact avec lui pour coordonner.</p>
          </div>
          <button onClick={() => router.push('/services/tgr')}
            className="w-full py-3 bg-brand text-white rounded-xl font-semibold">
            Retour aux missions
          </button>
        </>
      )}
      {status === 'taken' && (
        <>
          <div className="text-7xl">⚠️</div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Mission déjà prise</h2>
            <p className="text-zinc-400 text-sm">Un autre partenaire a été plus rapide.</p>
          </div>
          <button onClick={() => router.push('/services/tgr')}
            className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 rounded-xl text-sm">
            Retour
          </button>
        </>
      )}
      {status === 'error' && (
        <>
          <div className="text-7xl">❌</div>
          <p className="text-red-400 text-sm">{message}</p>
          <button onClick={() => router.push('/services/tgr')}
            className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-400 rounded-xl text-sm">
            Retour
          </button>
        </>
      )}
    </div>
  )
}

export default function TGRTakePage() {
  return (
    <AppShell title="Prise de mission TGR">
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-zinc-500">Chargement…</p>
        </div>
      }>
        <TGRTakeContent />
      </Suspense>
    </AppShell>
  )
}

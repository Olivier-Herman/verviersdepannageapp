'use client'

import { signIn, useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import Image from 'next/image'

function LoginContent() {
  const params = useSearchParams()
  const router = useRouter()
  const { data: session, status, update } = useSession()
  const error = params.get('error')
  const callbackUrl = params.get('callbackUrl') || '/dashboard'
  const [isPwa, setIsPwa] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    setIsPwa(isStandalone)
  }, [])

  // Si session trouvée → rediriger vers dashboard
  useEffect(() => {
    if (status === 'authenticated' && session) {
      router.push(callbackUrl)
    }
  }, [status, session])

  // Quand la PWA reprend le focus (retour depuis Safari après auth)
  // → vérifier si la session existe maintenant
  useEffect(() => {
    if (!isPwa) return

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        setChecking(true)
        await update() // forcer la mise à jour de la session
        setChecking(false)
      }
    }

    const handleFocus = async () => {
      setChecking(true)
      await update()
      setChecking(false)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [isPwa, update])

  const handleSignIn = () => {
    signIn('azure-ad', { callbackUrl, redirect: true })
  }

  if (status === 'loading' || checking) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Vérification de la session…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
      <div className="mb-10 text-center">
        <div className="bg-white rounded-2xl px-8 py-5 inline-block mb-4">
          <Image
            src="/logo.png"
            alt="Verviers Dépannage"
            width={220}
            height={220}
            style={{ width: '220px', height: 'auto' }}
            className="object-contain"
            priority
          />
        </div>
        <p className="text-zinc-500 text-sm">Application interne — Chauffeurs & Gestion</p>
      </div>

      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-2">Connexion</h1>
        <p className="text-zinc-500 text-sm mb-8">
          Utilise ton compte Microsoft professionnel pour accéder à l'application.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-6">
            {error === 'AccessDenied'
              ? "Accès refusé. Ton compte n'est pas autorisé."
              : 'Une erreur est survenue. Réessaie.'}
          </div>
        )}

        <button
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-zinc-100 active:bg-zinc-200 text-zinc-900 font-semibold rounded-xl px-4 py-3.5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          Se connecter avec Microsoft
        </button>

        {isPwa && (
          <div className="mt-4 space-y-2">
            <p className="text-zinc-600 text-xs text-center">
              Après la connexion Microsoft, reviens ici et appuie sur :
            </p>
            <button
              onClick={async () => {
                setChecking(true)
                await update()
                setChecking(false)
              }}
              className="w-full bg-[#1e1e1e] border border-[#333] text-zinc-400 text-sm rounded-xl px-4 py-3 transition-colors hover:border-zinc-500"
            >
              {checking ? 'Vérification…' : '✓ J\'ai terminé la connexion Microsoft'}
            </button>
          </div>
        )}

        <p className="text-zinc-600 text-xs text-center mt-6">
          Accès réservé aux employés Verviers Dépannage SA
        </p>
      </div>

      <p className="text-zinc-700 text-xs mt-8">
        v1.0.0 · app.verviersdepannage.com
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

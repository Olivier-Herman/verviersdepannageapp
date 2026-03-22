'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import Image from 'next/image'

function LoginContent() {
  const params = useSearchParams()
  const error = params.get('error')
  const callbackUrl = params.get('callbackUrl') || '/dashboard'
  const [isPwa, setIsPwa] = useState(false)

  useEffect(() => {
    // Détecter si on est en mode PWA standalone
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    setIsPwa(isStandalone)
  }, [])

  const handleSignIn = () => {
    if (isPwa) {
      // En mode PWA sur iOS — utiliser redirect pour rester dans le contexte
      signIn('azure-ad', {
        callbackUrl,
        redirect: true,
      })
    } else {
      signIn('azure-ad', { callbackUrl })
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
      {/* Logo */}
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

      {/* Card */}
      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-2">Connexion</h1>
        <p className="text-zinc-500 text-sm mb-8">
          Utilise ton compte Microsoft professionnel pour accéder à l'application.
        </p>

        {/* Erreur */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-6">
            {error === 'AccessDenied'
              ? "Accès refusé. Ton compte n'est pas autorisé."
              : 'Une erreur est survenue. Réessaie.'}
          </div>
        )}

        {/* Bouton Microsoft */}
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
          <p className="text-zinc-600 text-xs text-center mt-4">
            La connexion va ouvrir une page Microsoft puis revenir automatiquement.
          </p>
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

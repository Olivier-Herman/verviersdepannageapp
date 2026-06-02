'use client'

// /garage/activate?token=xxx — premier acces apres email de bienvenue.
// Valide le token signe + connecte le user via NextAuth credentials
// (mode magicToken), redirige vers /garage/set-password.
// Olivier 2026-06-02.

import { useEffect, useState, Suspense } from 'react'
import { signIn }                        from 'next-auth/react'
import { useRouter, useSearchParams }    from 'next/navigation'

function ActivateInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending')
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setStatus('error')
      setError('Lien invalide — pas de token. Demande un nouveau lien à ton contact Verviers Dépannage.')
      return
    }

    ;(async () => {
      try {
        // Decode minimal cote client pour recup l email (le user_id est dans le payload)
        // Le token est base64url("user_id:expires:sig"). On lit user_id pour le passer
        // a signIn, mais la verif HMAC se fait cote serveur dans authorize().
        const decoded = atob(token.replace(/-/g, '+').replace(/_/g, '/'))
        const [userId, expiresStr] = decoded.split(':')
        if (!userId || !expiresStr) throw new Error('Token mal formé')
        if (Date.now() / 1000 > Number(expiresStr)) {
          throw new Error('Lien expiré (validité 24h). Demande un nouveau lien à ton contact Verviers Dépannage.')
        }

        // Fetch email via une mini-route pour eviter de l avoir dans le token
        const emailRes  = await fetch(`/api/garage/user-email?id=${encodeURIComponent(userId)}`)
        const emailData = await emailRes.json()
        if (!emailRes.ok || !emailData.email) {
          throw new Error(emailData.error || 'Compte introuvable')
        }

        const result = await signIn('credentials', {
          email:      emailData.email,
          magicToken: token,
          redirect:   false,
        })

        if (result?.error) {
          throw new Error('Lien invalide ou expiré. Demande un nouveau lien à ton contact Verviers Dépannage.')
        }

        setStatus('ok')
        // Redirige vers la page de définition de mdp (must_change_password=true)
        setTimeout(() => router.replace('/garage/set-password'), 600)
      } catch (e: any) {
        setStatus('error')
        setError(e?.message || 'Erreur d activation')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-amber-50 px-4">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8 max-w-md w-full text-center space-y-4">
        <div className="text-5xl mb-2">🚗</div>
        <h1 className="text-2xl font-bold text-gray-900">VD Soft — Activation</h1>

        {status === 'pending' && (
          <>
            <div className="flex justify-center py-4">
              <div className="animate-spin h-10 w-10 border-4 border-red-600 border-t-transparent rounded-full" />
            </div>
            <p className="text-gray-600 text-sm">Activation de votre compte en cours…</p>
          </>
        )}

        {status === 'ok' && (
          <>
            <div className="text-5xl">✅</div>
            <p className="text-green-700 font-semibold">Compte activé !</p>
            <p className="text-gray-600 text-sm">Redirection vers la définition de votre mot de passe…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-5xl">⚠️</div>
            <p className="text-red-700 font-semibold">Activation impossible</p>
            <p className="text-gray-600 text-sm">{error}</p>
            <button onClick={() => router.replace('/garage/login')}
              className="mt-4 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm">
              Aller à la page de connexion
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function GarageActivatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Chargement…</div>}>
      <ActivateInner />
    </Suspense>
  )
}

'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'

function RequestContent() {
  const router = useRouter()
  const [step, setStep] = useState<'method' | 'email_form' | 'done'>('method')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleOAuthRequest = async (provider: string) => {
    setLoading(true)
    // On passe callbackUrl vers une page de confirmation
    await signIn(provider, { callbackUrl: '/request-access/pending' })
  }

  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !name) return
    setLoading(true); setError('')

    const res = await fetch('/api/auth/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) { setError(data.error || 'Erreur'); return }
    setStep('done')
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-white font-bold text-lg mb-3">Demande envoyée !</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Votre demande d'accès a été transmise à l'administration. Vous recevrez un email dès que votre compte sera activé.
          </p>
          <Link href="/login" className="text-brand text-sm hover:underline">← Retour à la connexion</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="bg-white rounded-2xl px-8 py-5 inline-block mb-4">
          <Image src="/logo.jpg" alt="Verviers Dépannage" width={180} height={180}
            style={{ width: '180px', height: 'auto' }} className="object-contain" priority />
        </div>
      </div>

      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-2">Demander un accès</h1>
        <p className="text-zinc-500 text-sm mb-6">
          Choisissez votre méthode de connexion préférée. Votre compte sera activé par un administrateur.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
        )}

        {step === 'method' && (
          <div className="flex flex-col gap-3">
            {/* Email/mot de passe */}
            <button onClick={() => setStep('email_form')}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95">
              <span className="text-lg">✉️</span>
              <div className="text-left">
                <p className="text-sm font-medium">Email & mot de passe</p>
                <p className="text-zinc-600 text-xs">Compte avec mot de passe</p>
              </div>
            </button>

            {/* Microsoft */}
            <button onClick={() => handleOAuthRequest('azure-ad')} disabled={loading}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95 disabled:opacity-40">
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" className="flex-shrink-0">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              <div className="text-left">
                <p className="text-sm font-medium">Microsoft professionnel</p>
                <p className="text-zinc-600 text-xs">Compte Microsoft de l'entreprise</p>
              </div>
            </button>

            {/* Google */}
            <button onClick={() => handleOAuthRequest('google')} disabled={loading}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95 disabled:opacity-40">
              <svg width="20" height="20" viewBox="0 0 24 24" className="flex-shrink-0">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <div className="text-left">
                <p className="text-sm font-medium">Google</p>
                <p className="text-zinc-600 text-xs">Compte Gmail personnel</p>
              </div>
            </button>
          </div>
        )}

        {step === 'email_form' && (
          <form onSubmit={handleEmailRequest} className="flex flex-col gap-3">
            <button type="button" onClick={() => setStep('method')} className="text-zinc-600 text-xs hover:text-zinc-400 text-left mb-1">← Retour</button>
            <div>
              <label className="text-zinc-400 text-xs mb-1.5 block">Nom complet</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Prénom Nom"
                className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
            </div>
            <div>
              <label className="text-zinc-400 text-xs mb-1.5 block">Adresse email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="prenom@verviersdepannage.be"
                className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
            </div>
            <button type="submit" disabled={loading || !email || !name}
              className="w-full bg-brand text-white font-bold rounded-xl py-3.5 mt-1 disabled:opacity-40 active:scale-95 transition-all">
              {loading ? 'Envoi…' : 'Envoyer la demande'}
            </button>
          </form>
        )}

        <p className="text-zinc-700 text-xs text-center mt-5">
          Déjà un compte ? <Link href="/login" className="text-brand hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  )
}

export default function RequestAccessPage() {
  return <Suspense><RequestContent /></Suspense>
}

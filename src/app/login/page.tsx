'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'
import Image from 'next/image'

function LoginContent() {
  const params = useSearchParams()
  const router = useRouter()
  const error = params.get('error')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true); setLoginError('')

    const result = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)

    if (result?.error) { setLoginError('Email ou mot de passe incorrect'); return }

    const sessionRes = await fetch('/api/auth/session')
    const session = await sessionRes.json()
    if (session?.user?.mustChangePassword) router.push('/change-password')
    else router.push('/dashboard')
  }

  const handleOAuth = async (provider: string) => {
    setLoading(true)
    await signIn(provider, { callbackUrl: '/dashboard' })
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="bg-white rounded-2xl px-8 py-5 inline-block mb-4">
          <Image src="/logo.jpg" alt="Verviers Dépannage" width={200} height={200}
            style={{ width: '200px', height: 'auto' }} className="object-contain" priority />
        </div>
        <p className="text-zinc-500 text-sm">Application interne — Chauffeurs & Gestion</p>
      </div>

      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-6">Connexion</h1>

        {(error || loginError) && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-5">
            {loginError || 'Accès refusé ou compte non autorisé'}
          </div>
        )}

        {/* Email + mot de passe */}
        {showPassword ? (
          <form onSubmit={handleCredentials} className="flex flex-col gap-3 mb-5">
            <div>
              <label className="text-zinc-400 text-xs mb-1.5 block">Adresse email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="prenom@verviersdepannage.be" autoComplete="email"
                className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none transition-colors" />
            </div>
            <div>
              <label className="text-zinc-400 text-xs mb-1.5 block">Mot de passe</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password"
                className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none transition-colors" />
            </div>
            <button type="submit" disabled={loading || !email || !password}
              className="w-full bg-brand text-white font-bold rounded-xl py-3.5 disabled:opacity-40 active:scale-95 transition-all">
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
            <button type="button" onClick={() => setShowPassword(false)}
              className="text-zinc-600 text-xs text-center hover:text-zinc-400">
              ← Autres options
            </button>
            <div className="text-center">
              <a href="/forgot-password" className="text-zinc-600 text-xs hover:text-zinc-400">
                Mot de passe oublié ?
              </a>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Email/Mot de passe */}
            <button onClick={() => setShowPassword(true)}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95">
              <span className="text-lg">✉️</span>
              <span className="text-sm font-medium">Email & mot de passe</span>
            </button>

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-[#2a2a2a]" />
              <span className="text-zinc-600 text-xs">ou connexion avec</span>
              <div className="flex-1 h-px bg-[#2a2a2a]" />
            </div>

            {/* Microsoft M365 */}
            <button onClick={() => handleOAuth('azure-ad')} disabled={loading}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95 disabled:opacity-40">
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" className="flex-shrink-0">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              <span className="text-sm font-medium">Microsoft professionnel</span>
            </button>

            {/* Microsoft personnel */}
            <button onClick={() => handleOAuth('azure-personal')} disabled={loading}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95 disabled:opacity-40">
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" className="flex-shrink-0">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              <span className="text-sm font-medium">Microsoft personnel (Hotmail/Outlook)</span>
            </button>

            {/* Google */}
            <button onClick={() => handleOAuth('google')} disabled={loading}
              className="w-full flex items-center gap-3 bg-[#0F0F0F] border border-[#333] hover:border-zinc-500 text-white rounded-xl px-4 py-3.5 transition-all active:scale-95 disabled:opacity-40">
              <svg width="20" height="20" viewBox="0 0 24 24" className="flex-shrink-0">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="text-sm font-medium">Google</span>
            </button>
          </div>
        )}

        <p className="text-zinc-700 text-xs text-center mt-5">
          Accès réservé aux employés Verviers Dépannage SA
        </p>
      </div>

      <p className="text-zinc-700 text-xs mt-6">v1.0.0 · app.verviersdepannage.com</p>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginContent /></Suspense>
}

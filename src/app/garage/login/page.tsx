'use client'

// /garage/login — connexion email/mdp OU magic link.
// Olivier 2026-06-02. Cf [[project-espace-client-garages]].

import { Suspense, useState }        from 'react'
import { signIn }                    from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

function GarageLoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [mode, setMode]         = useState<'password' | 'magic'>('password')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const callbackUrl = params.get('callbackUrl') || '/garage'

  async function loginWithPassword() {
    setBusy(true); setMsg(null)
    try {
      const res = await signIn('credentials', {
        email, password,
        redirect: false,
      })
      if (res?.error) {
        setMsg({ kind: 'error', text: 'Email ou mot de passe incorrect.' })
      } else {
        router.replace(callbackUrl)
      }
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.message || 'Erreur de connexion' })
    } finally { setBusy(false) }
  }

  async function sendMagicLink() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/garage/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Echec envoi')
      setMsg({
        kind: 'success',
        text: `📧 Si un compte existe avec cet email, un lien de connexion vient d'être envoyé. Vérifie ta boîte de réception (et les spams).`,
      })
      setPassword('')
    } catch (e: any) {
      // Pour des raisons de securite, on retourne toujours un message generique
      // (ne pas reveler si l email existe ou pas)
      setMsg({
        kind: 'success',
        text: `📧 Si un compte existe avec cet email, un lien de connexion vient d'être envoyé.`,
      })
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-amber-50 px-4 py-12">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8 max-w-md w-full space-y-5">
        <div className="text-center space-y-2">
          <div className="text-5xl">🚗</div>
          <h1 className="text-2xl font-bold text-gray-900">VD Soft</h1>
          <p className="text-gray-500 text-sm">Espace partenaire garage</p>
        </div>

        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => { setMode('password'); setMsg(null) }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${mode === 'password' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            🔒 Mot de passe
          </button>
          <button onClick={() => { setMode('magic'); setMsg(null) }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${mode === 'magic' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            ✨ Lien magique
          </button>
        </div>

        <div>
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="contact@garage.be"
            autoComplete="email"
            className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
        </div>

        {mode === 'password' && (
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-1.5">Mot de passe</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              onKeyDown={e => e.key === 'Enter' && email && password && loginWithPassword()}
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </div>
        )}

        {msg && (
          <div className={`rounded-xl px-4 py-3 text-sm ${msg.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
            {msg.text}
          </div>
        )}

        {mode === 'password' ? (
          <button onClick={loginWithPassword}
            disabled={busy || !email || !password}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition">
            {busy ? '⏳ Connexion…' : 'Se connecter'}
          </button>
        ) : (
          <button onClick={sendMagicLink}
            disabled={busy || !email}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition">
            {busy ? '⏳ Envoi…' : '📧 Envoyer le lien magique'}
          </button>
        )}

        {mode === 'password' && (
          <p className="text-center text-gray-500 text-xs">
            Mot de passe oublié ? <button onClick={() => setMode('magic')} className="text-red-600 font-semibold hover:underline">Recevoir un lien magique</button>
          </p>
        )}

        <p className="text-center text-gray-400 text-[11px] pt-4 border-t border-gray-100">
          Verviers Dépannage · Espace partenaire
        </p>
      </div>
    </div>
  )
}

export default function GarageLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">Chargement…</div>}>
      <GarageLoginInner />
    </Suspense>
  )
}

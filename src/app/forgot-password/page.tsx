'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    setLoading(false)

    if (!res.ok) {
      const d = await res.json()
      if (d.error === 'GOOGLE_PROVIDER') {
        setError('Ce compte utilise Google pour se connecter. Utilisez le bouton Google sur la page de connexion — aucun mot de passe n\'est associé à ce compte.')
      } else if (d.error === 'MICROSOFT_PROVIDER') {
        setError('Ce compte utilise Microsoft professionnel pour se connecter. Utilisez le bouton Microsoft sur la page de connexion.')
      } else {
        setError(d.error || 'Erreur')
      }
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <div className="bg-white rounded-2xl px-6 py-4 inline-block mb-4">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>

      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-2">Mot de passe oublié</h1>

        {sent ? (
          <div>
            <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
              ✅ Un lien de réinitialisation a été envoyé à ton adresse email personnelle.
            </div>
            <Link href="/login" className="text-brand text-sm">← Retour à la connexion</Link>
          </div>
        ) : (
          <>
            <p className="text-zinc-500 text-sm mb-6">
              Saisis ton adresse email professionnelle — un lien sera envoyé à ton email personnel.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Email professionnel</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="prenom@verviersdepannage.be"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
              </div>
              <button type="submit" disabled={loading || !email}
                className="w-full bg-brand text-white font-bold rounded-xl py-3.5 mt-2 disabled:opacity-40">
                {loading ? 'Envoi…' : 'Envoyer le lien'}
              </button>
            </form>

            <div className="text-center mt-4">
              <Link href="/login" className="text-zinc-600 text-xs hover:text-zinc-400">← Retour</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

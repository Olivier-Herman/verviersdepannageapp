'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

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
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <div className="bg-white rounded-2xl px-6 py-4 inline-block mb-4 shadow-card">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>

      <div className="w-full max-w-sm bg-surface border rounded-card shadow-card p-8">
        <h1 className="font-display text-ink text-xl font-bold mb-2">Mot de passe oublié</h1>

        {sent ? (
          <div>
            <div className="bg-success-soft text-success text-sm rounded-md px-4 py-3 mb-4">
              ✅ Un lien de réinitialisation a été envoyé à ton adresse email personnelle.
            </div>
            <Link href="/login" className="text-brand hover:underline text-sm">← Retour à la connexion</Link>
          </div>
        ) : (
          <>
            <p className="text-ink-muted text-sm mb-6">
              Saisis ton adresse email professionnelle — un lien sera envoyé à ton email personnel.
            </p>

            {error && (
              <div className="bg-critical-soft text-critical text-sm rounded-md px-4 py-3 mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Input
                label="Email professionnel"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="prenom@verviersdepannage.be"
                required
              />
              <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={!email} className="mt-2">
                Envoyer le lien
              </Button>
            </form>

            <div className="text-center mt-4">
              <Link href="/login" className="text-ink-faint hover:text-ink-secondary text-xs transition-colors">← Retour</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

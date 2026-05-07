'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

function ResetContent() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token')
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd !== confirm) { setError('Les mots de passe ne correspondent pas'); return }
    if (newPwd.length < 8) { setError('Min. 8 caractères'); return }

    setLoading(true); setError('')
    const res = await fetch('/api/auth/reset-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: newPwd })
    })
    setLoading(false)
    if (res.ok) { setSuccess(true); setTimeout(() => router.push('/login'), 2000) }
    else { const d = await res.json(); setError(d.error) }
  }

  if (!token) return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <p className="text-critical">Lien invalide. <Link href="/forgot-password" className="text-brand hover:underline">Recommencer</Link></p>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8">
        <div className="bg-white rounded-2xl px-6 py-4 inline-block shadow-card">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>
      <div className="w-full max-w-sm bg-surface border rounded-card shadow-card p-8">
        <h1 className="font-display text-ink text-xl font-bold mb-6">Nouveau mot de passe</h1>
        {success ? (
          <div className="bg-success-soft text-success text-sm rounded-md px-4 py-3">
            ✅ Mot de passe modifié ! Redirection…
          </div>
        ) : (
          <>
            {error && <div className="bg-critical-soft text-critical text-sm rounded-md px-4 py-3 mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Input label="Nouveau mot de passe" type="password" value={newPwd} onChange={setNewPwd} placeholder="Min. 8 caractères" />
              <Input label="Confirmer" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" />
              <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={!newPwd || !confirm} className="mt-2">
                Définir le mot de passe
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return <Suspense><ResetContent /></Suspense>
}

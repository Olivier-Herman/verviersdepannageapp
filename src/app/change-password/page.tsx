'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export default function ChangePasswordPage() {
  const router = useRouter()
  const { update } = useSession()
  const [current, setCurrent] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd !== confirm) { setError('Les mots de passe ne correspondent pas'); return }
    if (newPwd.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères'); return }
    if (newPwd === '!Verviers4800') { setError('Tu dois choisir un nouveau mot de passe différent du mot de passe par défaut'); return }

    setLoading(true); setError('')
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPwd })
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) { setError(data.error); return }
    await update({ mustChangePassword: false })
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <div className="bg-white rounded-2xl px-6 py-4 inline-block mb-4 shadow-card">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>

      <div className="w-full max-w-sm bg-surface border rounded-card shadow-card p-8">
        <h1 className="font-display text-ink text-xl font-bold mb-2">Changer le mot de passe</h1>
        <p className="text-ink-muted text-sm mb-6">
          C&apos;est ta première connexion. Tu dois définir un nouveau mot de passe personnel.
        </p>

        {error && (
          <div className="bg-critical-soft text-critical text-sm rounded-md px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input label="Mot de passe actuel" type="password" value={current} onChange={setCurrent} placeholder="••••••••" />
          <Input label="Nouveau mot de passe" type="password" value={newPwd} onChange={setNewPwd} placeholder="Min. 8 caractères" />
          <Input label="Confirmer le nouveau mot de passe" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" />
          <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={!current || !newPwd || !confirm} className="mt-2">
            Définir mon mot de passe
          </Button>
        </form>
      </div>
    </div>
  )
}

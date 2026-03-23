'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Image from 'next/image'

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
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <div className="bg-white rounded-2xl px-6 py-4 inline-block mb-4">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>

      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-2">Changer le mot de passe</h1>
        <p className="text-zinc-500 text-sm mb-6">
          C'est ta première connexion. Tu dois définir un nouveau mot de passe personnel.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="text-zinc-400 text-xs mb-1.5 block">Mot de passe actuel</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
          </div>
          <div>
            <label className="text-zinc-400 text-xs mb-1.5 block">Nouveau mot de passe</label>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
              placeholder="Min. 8 caractères"
              className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
          </div>
          <div>
            <label className="text-zinc-400 text-xs mb-1.5 block">Confirmer le nouveau mot de passe</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
          </div>

          <button type="submit" disabled={loading || !current || !newPwd || !confirm}
            className="w-full bg-brand text-white font-bold rounded-xl py-3.5 mt-2 disabled:opacity-40 active:scale-95 transition-all">
            {loading ? 'Enregistrement…' : 'Définir mon mot de passe'}
          </button>
        </form>
      </div>
    </div>
  )
}

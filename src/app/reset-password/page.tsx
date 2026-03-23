'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'

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
    <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center px-6">
      <p className="text-red-400">Lien invalide. <Link href="/forgot-password" className="text-brand">Recommencer</Link></p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
      <div className="mb-8">
        <div className="bg-white rounded-2xl px-6 py-4 inline-block">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>
      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8">
        <h1 className="text-white text-xl font-semibold mb-6">Nouveau mot de passe</h1>
        {success ? (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3">
            ✅ Mot de passe modifié ! Redirection…
          </div>
        ) : (
          <>
            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Nouveau mot de passe</label>
                <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min. 8 caractères"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
              </div>
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Confirmer</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-sm outline-none" />
              </div>
              <button type="submit" disabled={loading || !newPwd || !confirm}
                className="w-full bg-brand text-white font-bold rounded-xl py-3.5 mt-2 disabled:opacity-40">
                {loading ? 'Enregistrement…' : 'Définir le mot de passe'}
              </button>
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

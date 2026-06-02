'use client'

// /garage/set-password — premier acces : forcer la definition d un mdp.
// Olivier 2026-06-02. Apres save, le user est redirige vers /garage.

import { useEffect, useState } from 'react'
import { useSession }          from 'next-auth/react'
import { useRouter }           from 'next/navigation'

export default function GarageSetPasswordPage() {
  const router = useRouter()
  const { data: session, status, update } = useSession()
  const [password, setPassword]   = useState('')
  const [confirm,  setConfirm]    = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/garage/login')
  }, [status, router])

  async function save() {
    if (password.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return }
    if (password !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/garage/set-initial-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur')
      await update()
      router.replace('/garage')
    } catch (e: any) {
      setError(e?.message || 'Erreur enregistrement')
    } finally { setBusy(false) }
  }

  if (status === 'loading' || status === 'unauthenticated') {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Chargement…</div>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-amber-50 px-4 py-12">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8 max-w-md w-full space-y-5">
        <div className="text-center space-y-2">
          <div className="text-5xl">🔐</div>
          <h1 className="text-2xl font-bold text-gray-900">Définissez votre mot de passe</h1>
          <p className="text-gray-500 text-sm">
            Bonjour <strong>{session?.user?.name}</strong>, choisis un mot de passe pour tes prochaines connexions.
          </p>
        </div>

        <div>
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Nouveau mot de passe</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Au moins 8 caractères"
            autoComplete="new-password"
            className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
        </div>

        <div>
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Confirmer</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            onKeyDown={e => e.key === 'Enter' && password && confirm && save()}
            className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">⚠️ {error}</p>}

        <button onClick={save}
          disabled={busy || !password || !confirm}
          className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition">
          {busy ? '⏳ Enregistrement…' : 'Enregistrer et continuer'}
        </button>

        <p className="text-center text-gray-400 text-[11px]">
          Une fois défini, vous pourrez vous connecter directement avec ce mot de passe.
        </p>
      </div>
    </div>
  )
}

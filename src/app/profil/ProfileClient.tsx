'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'

export default function ProfileClient({ user }: { user: any }) {
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [pinSuccess, setPinSuccess] = useState('')
  const [pinError, setPinError] = useState('')

  const hasPin = !!user?.verify_pin_hash

  const handleSetPin = async () => {
    if (!pin1 || !/^\d{4}$/.test(pin1)) { setPinError('Le PIN doit être 4 chiffres'); return }
    if (pin1 !== pin2) { setPinError('Les deux PIN ne correspondent pas'); return }
    setPinLoading(true); setPinError(''); setPinSuccess('')
    try {
      const res = await fetch('/api/admin/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin1 })
      })
      const data = await res.json()
      if (!res.ok) { setPinError(data.error); return }
      setPinSuccess('✅ PIN défini avec succès !')
      setPin1(''); setPin2('')
    } finally {
      setPinLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] max-w-md mx-auto flex flex-col">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/dashboard" className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</Link>
          <Link href="/dashboard" className="flex-1 flex justify-center">
            <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
          </Link>
          <div className="w-10" />
        </div>
        <h1 className="text-white font-bold text-lg">Mon Profil</h1>
      </div>

      <div className="flex-1 px-5 py-6 flex flex-col gap-4">

        {/* Infos utilisateur */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
          <div className="w-16 h-16 rounded-full bg-brand flex items-center justify-center text-white text-2xl font-bold mb-4 mx-auto">
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <p className="text-white font-bold text-center text-lg">{user?.name}</p>
          <p className="text-zinc-500 text-sm text-center">{user?.email}</p>
          <div className="flex justify-center mt-2">
            <span className="text-xs bg-brand/20 text-brand px-3 py-1 rounded-full font-medium">
              {user?.role}
            </span>
          </div>
        </div>

        {/* PIN de validation — visible seulement si can_verify */}
        {user?.can_verify && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">PIN de validation caisse</h2>
            <p className="text-zinc-500 text-xs mb-4">
              {hasPin
                ? 'Ton PIN est défini. Tu peux le modifier ci-dessous.'
                : 'Aucun PIN défini. Crée-en un pour pouvoir valider les remises d\'espèces.'}
            </p>

            {pinSuccess && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
                {pinSuccess}
              </div>
            )}
            {pinError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {pinError}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">
                  {hasPin ? 'Nouveau PIN' : 'PIN (4 chiffres)'}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin1}
                  onChange={e => { setPin1(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest"
                />
              </div>
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Confirmer le PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin2}
                  onChange={e => { setPin2(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest"
                />
              </div>
              <button
                onClick={handleSetPin}
                disabled={pinLoading || pin1.length !== 4 || pin2.length !== 4}
                className="w-full bg-brand text-white font-bold rounded-xl py-3 disabled:opacity-40 active:scale-95 transition-all"
              >
                {pinLoading ? '…' : hasPin ? 'Modifier le PIN' : 'Définir le PIN'}
              </button>
            </div>
          </div>
        )}

        {/* Déconnexion */}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full bg-[#1A1A1A] border border-[#333] text-red-400 font-medium rounded-2xl py-4 active:scale-95 transition-all"
        >
          Se déconnecter
        </button>

      </div>
    </div>
  )
}

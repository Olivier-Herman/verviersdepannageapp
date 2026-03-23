'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import AppShell from '@/components/layout/AppShell'

export default function ProfileClient({ user }: { user: any }) {
  const [pin1,        setPin1]        = useState('')
  const [pin2,        setPin2]        = useState('')
  const [pinLoading,  setPinLoading]  = useState(false)
  const [pinSuccess,  setPinSuccess]  = useState('')
  const [pinError,    setPinError]    = useState('')

  const hasPin = !!user?.verify_pin_hash

  const handleSetPin = async () => {
    if (!pin1 || !/^\d{4}$/.test(pin1)) { setPinError('Le PIN doit être 4 chiffres'); return }
    if (pin1 !== pin2)                   { setPinError('Les deux PIN ne correspondent pas'); return }
    setPinLoading(true); setPinError(''); setPinSuccess('')
    try {
      const res  = await fetch('/api/admin/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin1 }),
      })
      const data = await res.json()
      if (!res.ok) { setPinError(data.error); return }
      setPinSuccess('✅ PIN défini avec succès !')
      setPin1(''); setPin2('')
    } finally {
      setPinLoading(false)
    }
  }

  const initials = user?.name?.[0]?.toUpperCase() || '?'

  return (
    <AppShell title="Mon Profil" userRole={user?.role} userName={user?.name}>

      <div className="px-4 lg:px-8 py-6 max-w-lg mx-auto lg:mx-0">

        {/* Carte utilisateur */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-6 mb-4">
          <div className="w-20 h-20 rounded-full bg-brand flex items-center justify-center
                          text-white text-3xl font-bold mb-4 mx-auto lg:mx-0">
            {initials}
          </div>
          <p className="text-white font-bold text-xl text-center lg:text-left">{user?.name}</p>
          <p className="text-zinc-500 text-sm text-center lg:text-left mt-0.5">{user?.email}</p>
          <div className="flex justify-center lg:justify-start mt-3">
            <span className="text-xs bg-brand/20 text-brand px-3 py-1 rounded-full font-medium capitalize">
              {user?.role}
            </span>
          </div>
        </div>

        {/* PIN de validation */}
        {user?.can_verify && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5 mb-4">
            <h2 className="text-white font-bold mb-1">PIN de validation caisse</h2>
            <p className="text-zinc-500 text-xs mb-4">
              {hasPin
                ? 'Ton PIN est défini. Tu peux le modifier ci-dessous.'
                : "Aucun PIN défini. Crée-en un pour valider les remises d'espèces."}
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
                <input type="password" inputMode="numeric" maxLength={4} value={pin1}
                  onChange={e => { setPin1(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl
                             px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest" />
              </div>
              <div>
                <label className="text-zinc-400 text-xs mb-1.5 block">Confirmer le PIN</label>
                <input type="password" inputMode="numeric" maxLength={4} value={pin2}
                  onChange={e => { setPin2(e.target.value.replace(/[^0-9]/g, '')); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl
                             px-4 py-3 text-white text-2xl font-bold text-center outline-none tracking-widest" />
              </div>
              <button onClick={handleSetPin}
                disabled={pinLoading || pin1.length !== 4 || pin2.length !== 4}
                className="w-full bg-brand text-white font-bold rounded-xl py-3 disabled:opacity-40 transition-all">
                {pinLoading ? '…' : hasPin ? 'Modifier le PIN' : 'Définir le PIN'}
              </button>
            </div>
          </div>
        )}

        {/* Déconnexion */}
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full bg-[#1A1A1A] border border-[#333] text-red-400 font-medium
                     rounded-2xl py-4 active:scale-95 transition-all">
          Se déconnecter
        </button>
      </div>
    </AppShell>
  )
}

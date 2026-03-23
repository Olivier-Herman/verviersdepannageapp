'use client'

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'

export default function PendingPage() {
  const { data: session } = useSession()

  // Si le compte est actif → rediriger vers dashboard
  useEffect(() => {
    if ((session?.user as any)?.id) {
      fetch('/api/auth/session').then(r => r.json()).then(s => {
        if (s?.user) window.location.href = '/dashboard'
      })
    }
  }, [session])

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center px-6">
      <div className="mb-8">
        <div className="bg-white rounded-2xl px-8 py-5 inline-block">
          <Image src="/logo.jpg" alt="VD" width={160} height={160} style={{ width: '160px', height: 'auto' }} />
        </div>
      </div>
      <div className="w-full max-w-sm bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-8 text-center">
        <div className="text-4xl mb-4">⏳</div>
        <h2 className="text-white font-bold text-lg mb-3">Accès en attente</h2>
        <p className="text-zinc-400 text-sm mb-6">
          Votre demande a bien été reçue. Un administrateur va activer votre compte.<br/>
          Vous recevrez un email de confirmation.
        </p>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-zinc-600 text-xs hover:text-zinc-400">
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

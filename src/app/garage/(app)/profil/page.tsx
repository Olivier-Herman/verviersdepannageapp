'use client'

import { useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'

interface Partner {
  id:               string
  name:             string
  is_default:       boolean
  last_selected_at: string | null
}

export default function GarageProfilPage() {
  const { data: session } = useSession()
  const [partners, setPartners] = useState<Partner[]>([])
  const [current,  setCurrent]  = useState<Partner | null>(null)

  useEffect(() => {
    fetch('/api/garage/me/partners')
      .then(r => r.json())
      .then(d => { setPartners(d.partners || []); setCurrent(d.current || null) })
  }, [])

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Mon profil</h1>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-2 text-sm">
        <div>
          <p className="text-gray-500 text-xs uppercase font-semibold mb-0.5">Nom</p>
          <p className="text-gray-900 font-medium">{session?.user?.name || '—'}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase font-semibold mb-0.5">Email</p>
          <p className="text-gray-900 font-medium">{session?.user?.email || '—'}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <p className="text-gray-500 text-xs uppercase font-semibold mb-3">Mes entités ({partners.length})</p>
        {partners.length === 0 ? (
          <p className="text-gray-400 text-sm italic">Aucune entité liée. Contacte Verviers Dépannage.</p>
        ) : (
          <ul className="space-y-1">
            {partners.map(p => (
              <li key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${p.id === current?.id ? 'bg-red-50' : ''}`}>
                <span>🏢</span>
                <span className="text-gray-900 font-medium flex-1">{p.name}</span>
                {p.id === current?.id && <span className="text-red-600 text-xs font-bold">✓ Actuelle</span>}
                {p.is_default && p.id !== current?.id && <span className="text-gray-400 text-xs">⭐ par défaut</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-gray-400 text-xs mt-3">Pour ajouter / retirer une entité, contacte Verviers Dépannage.</p>
      </div>

      <button onClick={() => signOut({ callbackUrl: '/garage/login' })}
        className="w-full py-2.5 bg-white border border-red-300 text-red-700 hover:bg-red-50 rounded-xl text-sm font-medium">
        Se déconnecter
      </button>
    </div>
  )
}

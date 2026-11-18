'use client'
// Carte du tableau de bord du chauffeur : ses appels police envoyés par le dispatch, pas encore complétés
// (Olivier 18/11/2026). S'il a quitté l'écran, il retrouve l'appel ici. Rien si la liste est vide.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { T } from '@/lib/i18n/T'

export default function MesAppelsPolice() {
  const [appels, setAppels] = useState<{ id: string; address: string; status: string; note: string | null }[]>([])
  useEffect(() => {
    const go = () => fetch('/api/appels-police/mes', { cache: 'no-store' }).then(r => r.ok ? r.json() : { appels: [] }).then(j => setAppels(j.appels || [])).catch(() => {})
    go(); const t = setInterval(go, 30000); return () => clearInterval(t)
  }, [])
  if (!appels.length) return null
  return (
    <div className="mb-4 flex flex-col gap-2">
      {appels.map(a => (
        <Link key={a.id} href={`/mission/police?appel=${a.id}`} className="rounded-2xl border-2 border-red-600 bg-red-50 px-4 py-3 flex flex-col gap-1 min-h-[56px]">
          <span className="font-bold text-red-800"><T k="create_mission.appel_titre" /></span>
          <span className="text-stone-900 font-semibold">{a.address}</span>
          <span className="text-sm font-bold text-red-700 underline"><T k="create_mission.appel_ouvrir" /> →</span>
        </Link>
      ))}
    </div>
  )
}

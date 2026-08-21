'use client'

// Compte à rebours jusqu'à la clôture d'un lot.
//
// Rendu côté client uniquement : le serveur et le navigateur ne sont jamais à
// la même seconde, et Next hurle à l'hydratation. On affiche donc la date brute
// au premier rendu, puis le décompte prend le relais. Olivier 2026-08-21.

import { useEffect, useState } from 'react'

function reste(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return { txt: 'terminé', soon: true }
  const j = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return { txt: j > 0 ? `${j} j ${h} h` : `${h} h ${m} min`, soon: j < 1 }
}

export default function Countdown({ iso }: { iso: string | null }) {
  const [now, setNow] = useState<string | null>(null)

  useEffect(() => {
    if (!iso) return
    const tick = () => setNow(reste(iso).txt)
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [iso])

  if (!iso) return <>—</>
  if (now === null) return <>{new Date(iso).toLocaleDateString('fr-BE')}</>
  return <span className={reste(iso).soon ? 'clock soon' : 'clock'}>{now}</span>
}

'use client'
// Envoi des fiches faites hors ligne (Olivier 12/11/2026) — voir src/lib/client/fiches-hors-ligne.ts.
// Dans l'app iPhone seulement (plugin FichesHorsLigne) : à l'ouverture, au retour du réseau,
// au retour dans l'app et toutes les 2 minutes, les fiches gardées dans le téléphone partent.
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { copierListes, envoyerFiches, pluginHorsLigne } from '@/lib/client/fiches-hors-ligne'

export default function FichesHorsLigneSync() {
  const { status } = useSession()
  const [envoyees, setEnvoyees] = useState(0)

  useEffect(() => {
    if (status !== 'authenticated' || !pluginHorsLigne()) return
    let fini = false
    const go = async () => {
      if (fini || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
      const n = await envoyerFiches()
      if (n > 0 && !fini) setEnvoyees(n)
    }
    copierListes().catch(() => {})
    go()
    const onVis = () => { if (document.visibilityState === 'visible') go() }
    window.addEventListener('online', go)
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(go, 120_000)
    return () => { fini = true; window.removeEventListener('online', go); document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [status])

  useEffect(() => {
    if (!envoyees) return
    const t = setTimeout(() => setEnvoyees(0), 8000)
    return () => clearTimeout(t)
  }, [envoyees])

  if (!envoyees) return null
  return (
    <div role="status" className="fixed left-3 right-3 z-[90] rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 text-sm font-medium shadow-lg flex items-center gap-3"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}>
      <span className="text-lg">📵</span>
      <span className="flex-1">{envoyees === 1 ? 'Ta fiche faite hors ligne est envoyée.' : `Tes ${envoyees} fiches faites hors ligne sont envoyées.`}</span>
      <button onClick={() => setEnvoyees(0)} className="min-w-[44px] min-h-[44px] text-emerald-800" aria-label="Fermer">✕</button>
    </div>
  )
}

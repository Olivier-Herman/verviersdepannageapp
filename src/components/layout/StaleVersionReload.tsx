'use client'
// App figée au retour du verrouillage (Olivier 06/10/2026, Matthieu, Fred, Franck) : l'app
// restée en veille garde l'ancienne version ; après une mise en ligne, les morceaux de code
// qu'un bouton charge à la demande n'existent plus → le clic ne fait rien jusqu'à ce qu'on
// ferme l'app. Ici :
//  - au retour à l'écran (après ≥ 20 s d'absence), on compare la version de la page à celle
//    en ligne ; différente → rechargement (sauf saisie en cours : au prochain retour) ;
//  - un morceau de code introuvable (erreur de chargement) → rechargement immédiat, une fois.
import { useEffect } from 'react'

const MINE = process.env.NEXT_PUBLIC_BUILD_SHA || ''
const KEY = 'vd_stale_reload_at'

function reloadOnce(reason: string) {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 60_000) return   // jamais en boucle
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même */ }
  console.warn('[version] rechargement :', reason)
  window.location.reload()
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export default function StaleVersionReload() {
  useEffect(() => {
    let hiddenAt = 0
    const check = async () => {
      if (!MINE) return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        const { sha } = await r.json()
        if (sha && sha !== MINE && !typing()) reloadOnce('nouvelle version en ligne')
      } catch { /* hors réseau : on réessaiera au prochain retour */ }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      if (hiddenAt && Date.now() - hiddenAt >= 20_000) check()
    }
    const isChunkError = (e: any) => /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(e?.message || e?.name || e || ''))
    const onRejection = (ev: PromiseRejectionEvent) => { if (isChunkError(ev.reason)) reloadOnce('morceau de code introuvable') }
    const onError = (ev: ErrorEvent) => { if (isChunkError(ev.error || ev.message)) reloadOnce('morceau de code introuvable') }
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])
  return null
}

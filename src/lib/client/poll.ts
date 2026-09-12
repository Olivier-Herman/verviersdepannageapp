// src/lib/client/poll.ts
//
// Rafraîchissement périodique QUI DORT quand l'onglet n'est pas visible.
// Audit Vercel 12/09/2026 : les 10 routes les plus appelées (5 M sur 5,8 M
// d'invocations) étaient des écrans qui se rafraîchissent en boucle — y compris
// dans des onglets laissés ouverts en arrière-plan toute la journée. Ici :
// pas d'appel tant que l'onglet est caché, et un appel immédiat au retour si le
// dernier date de plus d'un intervalle. Un écran mural (tableau de bord) reste
// toujours visible : il n'est pas ralenti.
export function pollWhenVisible(fn: () => void | Promise<void>, ms: number, opts: { immediate?: boolean } = {}): () => void {
  if (typeof window === 'undefined') return () => {}
  let last = 0
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  const run = () => { last = Date.now(); try { void fn() } catch { /* le prochain tick réessaie */ } }
  if (opts.immediate !== false) run()
  const iv = setInterval(() => { if (visible()) run() }, ms)
  const onVis = () => { if (visible() && Date.now() - last >= ms) run() }
  document.addEventListener('visibilitychange', onVis)
  return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
}

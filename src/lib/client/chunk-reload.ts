// Ancienne version de l'app restée en mémoire après une mise en ligne : un morceau de code introuvable.
// Rechargement une fois (jamais en boucle). Utilisé par StaleVersionReload et par les écrans d'erreur, qui
// attrapent ce plantage avant les écouteurs globaux (6 « Loading chunk failed » en octobre 2026).
const KEY = 'vd_stale_reload_at'

export const isChunkError = (e: any) =>
  /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
    .test(String(e?.message || '') + ' ' + String(e?.name || '') + ' ' + (typeof e === 'string' ? e : ''))

/** true si la page se recharge. */
export function reloadOnce(reason: string): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 60_000) return false   // jamais en boucle
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même */ }
  console.warn('[version] rechargement :', reason)
  window.location.reload()
  return true
}

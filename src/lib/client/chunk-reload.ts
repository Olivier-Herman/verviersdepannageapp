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
  void rechargerQuandJoignable()
  return true
}

/**
 * Recharge seulement quand la page répond. Écrans blancs de Franck (29/10/2026) : un rechargement lancé au retour
 * dans l'app avec un réseau faible laissait la fenêtre blanche, et il fallait fermer l'app. On télécharge d'abord la
 * page ; tant qu'elle ne vient pas, l'écran actuel reste affiché et on réessaie (3 s, 6 s… jusqu'à 30 s).
 */
async function rechargerQuandJoignable(): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 10_000)
      const r = await fetch(window.location.href, { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal })
      clearTimeout(t)
      if (r.status < 500) { window.location.reload(); return }
    } catch { /* hors réseau ou trop lent : on réessaie */ }
    await new Promise(res => setTimeout(res, Math.min(30_000, 3_000 * i)))
  }
}

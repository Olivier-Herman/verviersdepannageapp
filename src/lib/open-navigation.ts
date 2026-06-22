// Ouverture d'un itinéraire dans l'app de navigation choisie (Google Maps /
// Waze / Plans), robuste sur l'app Android Capacitor.
//
// Problème corrigé : sur Android, `allowNavigation` inclut *.google.com (pour
// l'OAuth) → un lien https://www.google.com/maps/... se charge DANS la WebView,
// où la page Google redirige en `intent://` que la WebView ne sait pas ouvrir
// → ERR_UNKNOWN_URL_SCHEME ("Page Web non disponible").
//
// Solution : sur le build Android récent (identifié par le token UA `VDNav/`,
// posé via capacitor.config appendUserAgent + handler natif MainActivity), on
// ouvre directement le schéma d'app (`google.navigation:` / `waze://`) que le
// natif lance dans l'app — sans passer par google.com ni intent://.
// Partout ailleurs (iOS, navigateur web, ancien APK), on garde le lien https
// historique → aucune régression.

export type NavApp = 'gmaps' | 'waze' | 'apple'

/** URL https historique (iOS / web / ancien APK). */
export function navHttpsUrl(app: NavApp, lat?: number | null, lng?: number | null, addr?: string | null): string | null {
  const q = (lat != null && lng != null)
    ? `${lat},${lng}`
    : (addr ? encodeURIComponent(addr) : '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}

export function openNavigation(app: NavApp, lat?: number | null, lng?: number | null, addr?: string | null): void {
  if (typeof window === 'undefined') return
  const hasCoord = lat != null && lng != null
  const cap      = (window as any).Capacitor
  const isAndroid = !!cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'android'
  const hasNativeHandler = typeof navigator !== 'undefined' && /VDNav\//.test(navigator.userAgent)

  // Android récent : schéma d'app direct, intercepté par MainActivity.
  if (isAndroid && hasNativeHandler) {
    let scheme: string
    if (app === 'waze') {
      scheme = hasCoord
        ? `waze://?ll=${lat},${lng}&navigate=yes`
        : `waze://?q=${encodeURIComponent(addr || '')}&navigate=yes`
    } else {
      // gmaps (et apple → gmaps sur Android) : navigation turn-by-turn.
      scheme = `google.navigation:q=${hasCoord ? `${lat},${lng}` : encodeURIComponent(addr || '')}`
    }
    window.location.href = scheme
    return
  }

  // iOS / navigateur / ancien APK : lien https (comportement historique).
  const url = navHttpsUrl(app, lat, lng, addr)
  if (url) window.open(url, '_blank')
}

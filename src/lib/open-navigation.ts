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

/**
 * Adresse texte lisible par une app de navigation (Olivier 08/09/2026, mission
 * de Franck : « Rue Chapuis 4, VERVIERS, 4800, BEL » → Waze ne trouvait rien).
 * On retire le code pays (BEL / BE), on remet « code postal ville » dans l'ordre
 * belge et on termine par « Belgique ».
 */
export function cleanNavAddress(addr: string | null | undefined): string {
  let a = String(addr || '').replace(/\s+/g, ' ').trim()
  if (!a) return ''
  a = a.replace(/,?\s*\b(BEL|BE|Belgium|Belgique|België)\b\.?(?=\s*(,|$))/gi, '').replace(/,\s*,/g, ',').trim()
  // La fiche chauffeur ajoute la ville en fin d'adresse : on ne la garde qu'une fois.
  const segs = a.split(',').map(s => s.trim()).filter(Boolean)
  if (segs.length > 1 && segs.slice(0, -1).some(s => s.toLowerCase().includes(segs[segs.length - 1].toLowerCase()))) segs.pop()
  a = segs.join(', ')
  // « VERVIERS, 4800 » → « 4800 VERVIERS »
  a = a.replace(/,\s*([^,]+?)\s*,\s*(\d{4})\s*$/, (_m, city, zip) => `, ${zip} ${String(city).trim()}`)
  a = a.replace(/,\s*$/, '')
  return `${a}, Belgique`
}

/** URL https historique (iOS / web / ancien APK). */
export function navHttpsUrl(app: NavApp, lat?: number | null, lng?: number | null, addr?: string | null): string | null {
  const hasCoord = lat != null && lng != null
  const q = hasCoord ? `${lat},${lng}` : (addr ? encodeURIComponent(cleanNavAddress(addr)) : '')
  if (!q) return null
  // Waze : `ll=` n'accepte QUE des coordonnées ; une adresse texte passe par `q=`
  // (avant, le texte partait dans ll= → « aucune correspondance », copier-coller obligé).
  if (app === 'waze')  return hasCoord ? `https://waze.com/ul?ll=${q}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`
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
        : `waze://?q=${encodeURIComponent(cleanNavAddress(addr))}&navigate=yes`
    } else {
      // gmaps (et apple → gmaps sur Android) : navigation turn-by-turn.
      scheme = `google.navigation:q=${hasCoord ? `${lat},${lng}` : encodeURIComponent(cleanNavAddress(addr))}`
    }
    window.location.href = scheme
    return
  }

  // iOS / navigateur / ancien APK : lien https (comportement historique).
  const url = navHttpsUrl(app, lat, lng, addr)
  if (url) window.open(url, '_blank')
}

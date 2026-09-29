'use client'
// src/lib/geo/get-position.ts
//
// Position du téléphone pour les boutons « ma position » des écrans chauffeur.
// Fred Bovy, 29/09/2026 (fiche police) : « Impossible d'obtenir votre position ».
// Causes : dans l'app iPhone on passait par la localisation du navigateur intégré,
// et on n'acceptait que le GPS précis en 10 s — souvent trop court sous un pont,
// dans une cabine ou à l'intérieur. Ordre désormais :
//   1. app native : le plugin de localisation (permission propre à l'app) ;
//   2. GPS précis (15 s) ;
//   3. position approximative (Wi-Fi / antennes, 30 s, jusqu'à 2 min d'âge).

export type Position = { lat: number; lng: number; accuracy: number | null }

export class GeoError extends Error {
  constructor(public kind: 'denied' | 'unavailable', message: string) { super(message) }
}

const DENIED_MSG = 'Localisation refusée pour VD Soft. Sur iPhone : Réglages › VD Soft › Position › « Lorsque l’app est active ». Tu peux aussi taper l’adresse.'
const UNAVAILABLE_MSG = 'Position introuvable pour l’instant (pas de signal GPS). Réessaie dans quelques secondes à découvert, ou tape l’adresse.'

function webOnce(opts: PositionOptions): Promise<Position> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      e => reject(e.code === 1 ? new GeoError('denied', DENIED_MSG) : new GeoError('unavailable', UNAVAILABLE_MSG)),
      opts,
    )
  })
}

export async function getPosition(): Promise<Position> {
  // 1. App native (Capacitor) — jamais d'await sur un proxy de registerPlugin :
  //    le paquet @capacitor/geolocation expose un objet résolu, sans risque.
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation')
      const perm = await Geolocation.checkPermissions().catch(() => null)
      if (perm && perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        const req = await Geolocation.requestPermissions().catch(() => null)
        if (req && req.location === 'denied' && req.coarseLocation === 'denied') throw new GeoError('denied', DENIED_MSG)
      }
      try {
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 })
        return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }
      } catch {
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 30000, maximumAge: 120000 })
        return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }
      }
    }
  } catch (e) {
    if (e instanceof GeoError) throw e
    /* natif indisponible ou en échec : on tente la voie navigateur */
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new GeoError('unavailable', 'Localisation non disponible sur cet appareil : tape l’adresse.')
  try { return await webOnce({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }) }
  catch (e) {
    if (e instanceof GeoError && e.kind === 'denied') throw e
    return await webOnce({ enableHighAccuracy: false, timeout: 30000, maximumAge: 120000 })
  }
}

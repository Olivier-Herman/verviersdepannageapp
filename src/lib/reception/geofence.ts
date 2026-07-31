// src/lib/reception/geofence.ts
//
// Restriction de la borne visiteur par PRÉSENCE PHYSIQUE : le téléphone qui scanne
// doit être dans un rayon autour de l'accueil (Pepinster). Résout le cas « photo
// du QR scannée de chez soi » : la vraie position GPS est alors hors zone.
// Coords + rayon configurables via app_settings.reception_geofence
// ({ lat, lng, radius_m }). Défaut = dépôt Pepinster, 200 m. Olivier 2026-07-31.

const DEFAULT = { lat: 50.5703357, lng: 5.8216501, radius_m: 200 }

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export async function getGeofence(sb: any): Promise<{ lat: number; lng: number; radius_m: number }> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'reception_geofence').maybeSingle()
    const v = data?.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null
    if (v && Number.isFinite(+v.lat) && Number.isFinite(+v.lng)) {
      return { lat: +v.lat, lng: +v.lng, radius_m: +(v.radius_m) > 0 ? +v.radius_m : DEFAULT.radius_m }
    }
  } catch {}
  return DEFAULT
}

/** true si (lat,lng) est dans le rayon autorisé autour de l'accueil. */
export async function withinGeofence(sb: any, lat: any, lng: any): Promise<boolean> {
  const la = Number(lat), lo = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false
  const g = await getGeofence(sb)
  return distanceMeters(la, lo, g.lat, g.lng) <= g.radius_m
}

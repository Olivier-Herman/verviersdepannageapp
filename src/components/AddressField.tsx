'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'

// Charge le script Google Maps + Places (idempotent, partagé avec AddressField)
export function loadGoogleMaps(gmKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!gmKey) return reject(new Error('Clé Google Maps absente'))
    if ((window as any).google?.maps?.places) return resolve()
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script')
      s.id     = 'gm-script'
      // region=BE : biaise les résultats ambigus vers la Belgique (ex. même rue
      // en BE et en FR → la belge d'abord). Ne filtre pas : les adresses
      // étrangères restent proposées. Olivier 2026-06-29.
      s.src    = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=fr&region=BE`
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Échec chargement Google Maps'))
      document.head.appendChild(s)
    } else {
      const t = setInterval(() => {
        if ((window as any).google?.maps?.places) { clearInterval(t); resolve() }
      }, 200)
    }
  })
}

/**
 * Vérifie une adresse via Places Autocomplete + Place Details (côté client).
 * Plus tolérant que Geocoding API pour les adresses approximatives ou abrégées.
 * Retourne null si rien trouvé.
 */
export async function verifyAddressViaPlaces(
  address: string,
  gmKey:   string
): Promise<{ formatted: string; lat: number; lng: number; same: boolean } | null> {
  if (!address.trim()) return null
  await loadGoogleMaps(gmKey)
  const google = (window as any).google
  const acService = new google.maps.places.AutocompleteService()
  const predictions: any[] = await new Promise(resolve => {
    acService.getPlacePredictions(
      {
        input: address,
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        // Biais Belgique : les résultats belges remontent en premier (sans
        // exclure les pays frontaliers). Olivier 2026-06-29.
        bounds: new google.maps.LatLngBounds(
          { lat: 49.49, lng: 2.51 }, { lat: 51.51, lng: 6.41 }),
      },
      (results: any[], status: string) => {
        resolve(status === google.maps.places.PlacesServiceStatus.OK && results ? results : [])
      }
    )
  })
  if (predictions.length === 0) return null

  const placesService = new google.maps.places.PlacesService(document.createElement('div'))
  const details: any = await new Promise(resolve => {
    placesService.getDetails(
      { placeId: predictions[0].place_id, fields: ['name', 'formatted_address', 'geometry', 'types'] },
      (place: any, status: string) => {
        resolve(status === google.maps.places.PlacesServiceStatus.OK && place ? place : null)
      }
    )
  })
  if (!details?.geometry) return null

  const addr0 = details.formatted_address || predictions[0].description
  // Établissement (garage, hôtel…) : on préfixe le nom comme dans le widget,
  // pour conserver "Nom, adresse" même via cette re-vérification.
  const isEstab = (details.types || []).some((t: string) => t === 'establishment' || t === 'point_of_interest')
  const formatted = isEstab && details.name && !addr0.startsWith(details.name)
    ? `${details.name}, ${addr0}` : addr0
  const lat = details.geometry.location.lat()
  const lng = details.geometry.location.lng()
  // "Same" si l'adresse normalisée Google contient la 1re partie de l'input (rue+numéro)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const same = norm(formatted).includes(norm(address.split(',')[0]))
  return { formatted, lat, lng, same }
}

/**
 * Reverse-geocode (coords → localité) via le Geocoder Google côté client.
 * Utilisé pour transformer une borne d'autoroute (A27 BK22.3) résolue en
 * coordonnées → une ville affichable ("Jalhay"). Retourne null si échec.
 */
export async function reverseGeocodeCity(
  lat: number, lng: number, gmKey: string
): Promise<{ city: string | null; formatted: string | null } | null> {
  await loadGoogleMaps(gmKey)
  const google = (window as any).google
  const geocoder = new google.maps.Geocoder()
  const results: any[] = await new Promise(resolve => {
    geocoder.geocode({ location: { lat, lng }, language: 'fr' }, (res: any[], status: string) => {
      resolve(status === 'OK' && res ? res : [])
    })
  })
  if (results.length === 0) return null
  // Cherche la localité (locality) dans les composants d'adresse.
  let city: string | null = null
  for (const r of results) {
    const comp = (r.address_components || []).find((c: any) =>
      c.types.includes('locality') || c.types.includes('postal_town'))
    if (comp) { city = comp.long_name; break }
  }
  if (!city) {
    // repli : commune administrative niveau 2/3
    for (const r of results) {
      const comp = (r.address_components || []).find((c: any) =>
        c.types.includes('administrative_area_level_3') || c.types.includes('administrative_area_level_2'))
      if (comp) { city = comp.long_name; break }
    }
  }
  return { city, formatted: results[0]?.formatted_address || null }
}

export default function AddressField({
  label, value, onChange, onSelect, onParts, onBlur, gmKey, placeholder, className,
}: {
  label?:       string
  value:        string
  onChange:     (v: string) => void
  onSelect?:    (addr: string, lat: number, lng: number, city?: string, name?: string) => void
  /** Composants d'adresse découpés (pour pré-remplir un formulaire séparé, ex Touring). */
  onParts?:     (parts: { num: string; rue: string; cp: string; loc: string; name?: string }) => void
  onBlur?:      () => void
  gmKey:        string
  placeholder?: string
  className?:   string
}) {
  const ref         = useRef<HTMLInputElement>(null)
  const acRef       = useRef<any>(null)
  // Refs pour onChange + onSelect : evite closure stale (listener cree une
  // fois mais props peuvent changer entre re-renders). onSelectRef etait
  // deja en place ; ajout de onChangeRef pour symetrie (sinon le listener
  // appelait l ancienne version de onChange au clic suggestion -> input
  // controle se re-render avec ancienne valeur, l adresse semble non
  // selectionnee). Olivier 2026-05-25.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onPartsRef = useRef(onParts)
  onPartsRef.current = onParts

  // Suggestion "établissement à cette adresse" (recherche inverse non-destructive).
  // Quand on choisit une ADRESSE (pas un établissement), on cherche s'il y a un
  // commerce à ce point ; si oui on propose une pastille à ajouter. Olivier 2026-06-29.
  const [estabHint, setEstabHint] = useState<{ name: string; addr: string; lat: number; lng: number; city?: string } | null>(null)

  const lookupEstablishmentAt = (lat: number, lng: number, addr: string, city?: string) => {
    try {
      const g = (window as any).google
      const svc = new g.maps.places.PlacesService(document.createElement('div'))
      svc.nearbySearch(
        { location: { lat, lng }, rankBy: g.maps.places.RankBy.DISTANCE, type: 'establishment' },
        (results: any[], status: string) => {
          if (status !== g.maps.places.PlacesServiceStatus.OK || !results?.length) return
          const top = results[0]
          if (!top?.name || !top.geometry?.location) return
          // Garde-fou : l'établissement doit être quasiment AU point saisi (~40 m).
          const dLat = (top.geometry.location.lat() - lat) * 111000
          const dLng = (top.geometry.location.lng() - lng) * 111000 * Math.cos(lat * Math.PI / 180)
          const dist = Math.sqrt(dLat * dLat + dLng * dLng)
          if (dist <= 40 && !addr.toLowerCase().startsWith(top.name.toLowerCase())) {
            setEstabHint({ name: top.name, addr, lat, lng, city })
          }
        },
      )
    } catch { /* best-effort */ }
  }

  useEffect(() => {
    if (!ref.current || !gmKey) return

    const init = () => {
      if (!(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current!, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['name', 'formatted_address', 'geometry', 'address_components', 'types'],
        // Biais Belgique : priorise les adresses belges dans les suggestions
        // (strictBounds=false par défaut → les pays frontaliers restent
        // proposables si on tape une adresse étrangère). Olivier 2026-06-29.
        bounds: { south: 49.49, west: 2.51, north: 51.51, east: 6.41 },
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        if (!p?.geometry) return
        const addr = p.formatted_address || ''
        const lat  = p.geometry.location.lat()
        const lng  = p.geometry.location.lng()
        const cityComp = (p.address_components || []).find((c: any) => c.types.includes('locality'))
                     || (p.address_components || []).find((c: any) => c.types.includes('postal_town'))
        const city = cityComp?.long_name
        // Si c'est un établissement (garage, hôtel, etc.) et que name est utile (pas juste le numéro de rue),
        // on préfixe l'adresse avec le nom — sinon juste l'adresse.
        const isEstablishment = (p.types || []).some((t: string) => t === 'establishment' || t === 'point_of_interest')
        const name = isEstablishment && p.name && !addr.startsWith(p.name) ? p.name as string : undefined
        const display = name ? `${name}, ${addr}` : addr
        onChangeRef.current(display)
        onSelectRef.current?.(display, lat, lng, city, name)
        if (onPartsRef.current) {
          const comp = (t: string) => (p.address_components || []).find((c: any) => c.types.includes(t))?.long_name || ''
          onPartsRef.current({
            num: comp('street_number'),
            rue: comp('route'),
            cp:  comp('postal_code'),
            loc: comp('locality') || comp('postal_town') || comp('administrative_area_level_2') || '',
            name,
          })
        }
        // Si on a choisi une adresse simple, on tente de retrouver l'établissement
        // à ce point pour le proposer (pastille). Sinon on efface une suggestion.
        setEstabHint(null)
        if (!name) lookupEstablishmentAt(lat, lng, addr, city)
      })
    }

    if ((window as any).google?.maps?.places) { init(); return }
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script')
      s.id     = 'gm-script'
      s.src    = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=fr&region=BE`
      s.onload = init
      document.head.appendChild(s)
    } else {
      const t = setInterval(() => {
        if ((window as any).google?.maps?.places) { init(); clearInterval(t) }
      }, 200)
      return () => clearInterval(t)
    }
  }, [gmKey])

  return (
    <div>
      <Input
        ref={ref}
        label={label}
        value={value}
        onChange={e => { onChange(e); setEstabHint(null) }}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
        iconTrailing={<span aria-hidden="true">📍</span>}
      />
      {estabHint && (
        <button type="button"
          onClick={() => {
            const display = `${estabHint.name}, ${estabHint.addr}`
            onChangeRef.current(display)
            onSelectRef.current?.(display, estabHint.lat, estabHint.lng, estabHint.city, estabHint.name)
            setEstabHint(null)
          }}
          className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand/10 text-brand text-xs font-medium hover:bg-brand/20 transition">
          🏢 {estabHint.name} — ajouter ce nom à l'adresse
        </button>
      )}
    </div>
  )
}

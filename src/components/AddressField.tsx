'use client'

import { useEffect, useRef } from 'react'
import { Input } from '@/components/ui/Input'

// Charge le script Google Maps + Places (idempotent, partagé avec AddressField)
export function loadGoogleMaps(gmKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!gmKey) return reject(new Error('Clé Google Maps absente'))
    if ((window as any).google?.maps?.places) return resolve()
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script')
      s.id     = 'gm-script'
      s.src    = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=fr`
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
      { input: address, componentRestrictions: { country: ['be','lu','fr','nl','de'] } },
      (results: any[], status: string) => {
        resolve(status === google.maps.places.PlacesServiceStatus.OK && results ? results : [])
      }
    )
  })
  if (predictions.length === 0) return null

  const placesService = new google.maps.places.PlacesService(document.createElement('div'))
  const details: any = await new Promise(resolve => {
    placesService.getDetails(
      { placeId: predictions[0].place_id, fields: ['formatted_address', 'geometry'] },
      (place: any, status: string) => {
        resolve(status === google.maps.places.PlacesServiceStatus.OK && place ? place : null)
      }
    )
  })
  if (!details?.geometry) return null

  const formatted = details.formatted_address || predictions[0].description
  const lat = details.geometry.location.lat()
  const lng = details.geometry.location.lng()
  // "Same" si l'adresse normalisée Google contient la 1re partie de l'input (rue+numéro)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const same = norm(formatted).includes(norm(address.split(',')[0]))
  return { formatted, lat, lng, same }
}

export default function AddressField({
  label, value, onChange, onSelect, gmKey, placeholder, className,
}: {
  label?:       string
  value:        string
  onChange:     (v: string) => void
  onSelect?:    (addr: string, lat: number, lng: number, city?: string, name?: string) => void
  gmKey:        string
  placeholder?: string
  className?:   string
}) {
  const ref         = useRef<HTMLInputElement>(null)
  const acRef       = useRef<any>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!ref.current || !gmKey) return

    const init = () => {
      if (!(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current!, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['name', 'formatted_address', 'geometry', 'address_components', 'types'],
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
        onChange(display)
        onSelectRef.current?.(display, lat, lng, city, name)
      })
    }

    if ((window as any).google?.maps?.places) { init(); return }
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script')
      s.id     = 'gm-script'
      s.src    = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=fr`
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
    <Input
      ref={ref}
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      iconTrailing={<span aria-hidden="true">📍</span>}
    />
  )
}

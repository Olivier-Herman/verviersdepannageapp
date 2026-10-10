'use client'
// Saisie d'adresse avec l'autocomplétion Google, suggestions en boutons (le widget Google casse sur iPhone).
// À la sélection, la position est retrouvée dans le navigateur et transmise avec l'adresse.
import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'
import { IcoPin } from './suivi'

export interface AdresseChoisie { texte: string; lat: number | null; lng: number | null; nom?: string | null }

export default function AdresseInline({ valeur, onChange, placeholder, gps = false, autoFocus }: { valeur: AdresseChoisie; onChange: (a: AdresseChoisie) => void; placeholder?: string; gps?: boolean; autoFocus?: boolean }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  const [sugg, setSugg] = useState<{ id: string; principal: string; secondaire: string }[]>([])
  const [focus, setFocus] = useState(false)
  const [etatGps, setEtatGps] = useState<'idle' | 'busy' | 'err'>('idle')
  const t = useRef<any>(null)
  const svc = useRef<any>(null)

  useEffect(() => { if (key) loadGoogleMaps(key).then(() => { svc.current = new (window as any).google.maps.places.AutocompleteService() }).catch(() => {}) }, [key])

  const chercher = (q: string) => {
    clearTimeout(t.current)
    if (q.trim().length < 3 || !svc.current) { setSugg([]); return }
    t.current = setTimeout(() => {
      const g = (window as any).google
      svc.current.getPlacePredictions({ input: q, componentRestrictions: { country: ['be', 'lu', 'fr', 'nl', 'de'] }, bounds: new g.maps.LatLngBounds({ lat: 49.49, lng: 2.51 }, { lat: 51.51, lng: 6.41 }) },
        (res: any[] | null) => setSugg((res || []).slice(0, 5).map(p => ({ id: p.place_id, principal: p.structured_formatting?.main_text || p.description, secondaire: p.structured_formatting?.secondary_text || '' }))))
    }, 220)
  }

  const choisir = (id: string, libelle: string) => {
    const g = (window as any).google
    new g.maps.places.PlacesService(document.createElement('div')).getDetails({ placeId: id, fields: ['formatted_address', 'name', 'geometry', 'types'] }, (p: any) => {
      const estab = (p?.types || []).some((x: string) => x === 'establishment' || x === 'point_of_interest')
      const adr = p?.formatted_address || libelle
      onChange({ texte: estab && p?.name && !adr.startsWith(p.name) ? `${p.name}, ${adr}` : adr, lat: p?.geometry?.location?.lat() ?? null, lng: p?.geometry?.location?.lng() ?? null, nom: estab ? p?.name || null : null })
      setSugg([])
    })
  }

  const maPosition = () => {
    if (!navigator.geolocation) return setEtatGps('err')
    setEtatGps('busy')
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      try {
        await loadGoogleMaps(key)
        new (window as any).google.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[] | null) => {
          onChange({ texte: r?.[0]?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); setEtatGps('idle')
        })
      } catch { onChange({ texte: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); setEtatGps('idle') }
    }, () => setEtatGps('err'), { enableHighAccuracy: true, timeout: 12000 })
  }

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input className="input" style={{ paddingRight: 44 }} value={valeur.texte} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off"
          onChange={e => { onChange({ texte: e.target.value, lat: null, lng: null }); chercher(e.target.value) }}
          onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 200)} />
        {valeur.lat != null && <span title="Adresse localisée" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: 99, background: '#e5f6ee', color: '#13704b', display: 'grid', placeItems: 'center', fontWeight: 800 }}>✓</span>}
      </div>
      {focus && sugg.length > 0 && (
        <div className="sugg">
          {sugg.map(s => (
            <button key={s.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => choisir(s.id, `${s.principal}, ${s.secondaire}`)}>
              <IcoPin /><span><b>{s.principal}</b><small>{s.secondaire}</small></span>
            </button>
          ))}
        </div>
      )}
      {gps && (
        <button type="button" className="link" style={{ minHeight: 44, marginTop: 4 }} onClick={maPosition}>
          {etatGps === 'busy' ? 'Localisation…' : etatGps === 'err' ? 'Position indisponible : saisissez l’adresse' : '◎ Utiliser ma position actuelle'}
        </button>
      )}
    </div>
  )
}

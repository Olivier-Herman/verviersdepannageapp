'use client'
// Saisie d'adresse avec suggestions en boutons (pas le widget Google : il casse sur iPhone).
// À la sélection, la position est retrouvée dans le navigateur et transmise avec l'adresse.
import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'

export interface AdresseChoisie { texte: string; lat: number | null; lng: number | null }

export default function AdresseInline({ valeur, onChange, placeholder, autoFocus }: { valeur: AdresseChoisie; onChange: (a: AdresseChoisie) => void; placeholder?: string; autoFocus?: boolean }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  const [sugg, setSugg] = useState<{ id: string; principal: string; secondaire: string }[]>([])
  const [focus, setFocus] = useState(false)
  const [gps, setGps] = useState<'idle' | 'busy' | 'err'>('idle')
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
      onChange({ texte: estab && p?.name && !adr.startsWith(p.name) ? `${p.name}, ${adr}` : adr, lat: p?.geometry?.location?.lat() ?? null, lng: p?.geometry?.location?.lng() ?? null })
      setSugg([])
    })
  }

  const maPosition = () => {
    if (!navigator.geolocation) return setGps('err')
    setGps('busy')
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      try {
        await loadGoogleMaps(key)
        const g = (window as any).google
        new g.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[] | null) => {
          onChange({ texte: r?.[0]?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); setGps('idle')
        })
      } catch { onChange({ texte: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); setGps('idle') }
    }, () => setGps('err'), { enableHighAccuracy: true, timeout: 12000 })
  }

  return (
    <div>
      <div className="relative">
        <input
          className="esp-input pr-12" value={valeur.texte} placeholder={placeholder} autoFocus={autoFocus}
          onChange={e => { onChange({ texte: e.target.value, lat: null, lng: null }); chercher(e.target.value) }}
          onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 200)}
        />
        {valeur.lat != null && <span className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-emerald-100 text-emerald-700" title="Adresse localisée">✓</span>}
      </div>
      {focus && sugg.length > 0 && (
        <div className="esp-pop mt-2 overflow-hidden rounded-2xl border border-[#ece6df] bg-white">
          {sugg.map(s => (
            <button key={s.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => choisir(s.id, `${s.principal}, ${s.secondaire}`)} className="flex min-h-[48px] w-full items-center gap-3 border-b border-[#f3eee8] px-4 py-2 text-left last:border-0 hover:bg-rose-50/50">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-rose-500" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
              <span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-900">{s.principal}</span><span className="block truncate text-xs text-slate-500">{s.secondaire}</span></span>
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={maPosition} className="mt-2 inline-flex min-h-[40px] items-center gap-2 rounded-xl px-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /><circle cx="12" cy="12" r="8" /></svg>
        {gps === 'busy' ? 'Localisation…' : gps === 'err' ? 'Position indisponible — saisissez l’adresse' : 'Utiliser ma position actuelle'}
      </button>
    </div>
  )
}

'use client'
// src/components/AddressSuggestions.tsx — adresses Google proposées en gros boutons (Olivier 14/10/2026).
//
// Une adresse reçue d'une assistance (« R DE BATTICE 119, AUBEL Belgique ») n'a souvent pas de position :
// km, prix et scénario Siabis ne se calculaient pas, sans que personne s'en rende compte (1BBT931,
// 2FVH314). Au lieu de laisser passer le texte, on montre tout de suite les adresses Google les plus
// proches ; le chauffeur touche la bonne. Boutons, pas le widget Autocomplete (iPhone).
import { useEffect, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'

export interface PickedAddress { label: string; lat: number; lng: number }

/** « R DE BATTICE 119, AUBEL, BEL » → « R DE BATTICE 119, AUBEL » : le pays en clair gêne la recherche. */
function nettoyer(t: string): string {
  return t.replace(/\b(belgique|belgie|belgium|bel)\b\.?/gi, '').replace(/[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim()
}

export default function AddressSuggestions({ text, gmKey, onPick, max = 4 }: {
  text: string; gmKey: string; onPick: (a: PickedAddress) => void; max?: number
}) {
  const [preds, setPreds] = useState<{ id: string; main: string; sub: string }[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    const q = nettoyer(text || '')
    if (q.length < 4 || !gmKey) { setPreds([]); return }
    let stop = false
    setPreds(null)
    const t = setTimeout(async () => {
      try {
        await loadGoogleMaps(gmKey)
        const g = (window as any).google
        const svc = new g.maps.places.AutocompleteService()
        svc.getPlacePredictions({
          input: q,
          bounds: new g.maps.LatLngBounds({ lat: 49.49, lng: 2.51 }, { lat: 51.51, lng: 6.41 }),
        }, (res: any[], status: string) => {
          if (stop) return
          const ok = status === g.maps.places.PlacesServiceStatus.OK && res
          setPreds(ok ? res.slice(0, max).map((p: any) => ({
            id: p.place_id,
            main: p.structured_formatting?.main_text || p.description,
            sub: p.structured_formatting?.secondary_text || '',
          })) : [])
        })
      } catch { if (!stop) { setErr(true); setPreds([]) } }
    }, 350)
    return () => { stop = true; clearTimeout(t) }
  }, [text, gmKey, max])

  const choisir = async (id: string) => {
    setBusy(id)
    try {
      const g = (window as any).google
      const svc = new g.maps.places.PlacesService(document.createElement('div'))
      const place: any = await new Promise(resolve => svc.getDetails(
        { placeId: id, fields: ['name', 'formatted_address', 'geometry', 'types'] },
        (p: any, st: string) => resolve(st === g.maps.places.PlacesServiceStatus.OK ? p : null)))
      if (!place?.geometry) { setErr(true); return }
      const addr = place.formatted_address || ''
      const estab = (place.types || []).some((x: string) => x === 'establishment' || x === 'point_of_interest')
      const label = estab && place.name && !addr.startsWith(place.name) ? `${place.name}, ${addr}` : addr
      onPick({ label, lat: place.geometry.location.lat(), lng: place.geometry.location.lng() })
    } finally { setBusy(null) }
  }

  if (preds === null) return <p className="text-ink-muted text-sm">⏳ …</p>
  if (!preds.length) return err ? <p className="text-red-700 text-sm">⚠</p> : null
  return (
    <div className="grid gap-2">
      {preds.map(p => (
        <button key={p.id} type="button" disabled={!!busy} onClick={() => choisir(p.id)}
          className="w-full min-h-[52px] rounded-2xl border-2 border-blue-300 bg-blue-50 px-3 py-2 text-left disabled:opacity-50 active:border-blue-600">
          <span className="block text-gray-900 font-bold text-[15px]">{busy === p.id ? '⏳ ' : '📍 '}{p.main}</span>
          {p.sub && <span className="block text-gray-700 text-xs">{p.sub}</span>}
        </button>
      ))}
    </div>
  )
}

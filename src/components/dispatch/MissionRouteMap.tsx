'use client'

// Carte du trajet d'un chauffeur pour une mission (fiche dispatch).
//  - Polyline = positions GPS successives (pings 30s) de la mise en route à
//    la clôture.
//  - Marqueurs = lieux de pointage (acceptation, en route, sur place, chargé,
//    mise en parc, terminée) + lieu d'intervention + destination.
// Olivier 2026-06-16.

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'
import { useTheme } from '@/components/theme/ThemeProvider'

const DARK_MAP_STYLES: any[] = [
  { elementType: 'geometry',           stylers: [{ color: '#1A1A1A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F0F0F' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#9ca3af' }] },
  { featureType: 'water',                                 stylers: [{ color: '#0a2540' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'poi',                                   stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',                               stylers: [{ visibility: 'off' }] },
]
const LIGHT_MAP_STYLES: any[] = []

const DEFAULT_CENTER = { lat: 50.5912, lng: 5.8623 } // Verviers
const DEFAULT_ZOOM   = 12

// Libellé + couleur par type de pointage.
const POINT_META: Record<string, { label: string; color: string }> = {
  accept:            { label: 'Acceptée',      color: '#16a34a' },
  on_way:            { label: 'En route',      color: '#3b82f6' },
  on_site:           { label: 'Sur place',     color: '#f59e0b' },
  load_vehicle:      { label: 'Chargé',        color: '#f97316' },
  start_delivery:    { label: 'Livraison',     color: '#0ea5e9' },
  park:              { label: 'Mise en parc',  color: '#a855f7' },
  completed:         { label: 'Terminée',      color: '#dc2626' },
  complete_delivery: { label: 'Terminée',      color: '#dc2626' },
}

interface Pt { lat: number; lng: number; kind: string; recorded_at: string }
interface Place { lat: number; lng: number; address?: string }

interface Props {
  gmKey:       string
  pings:       Pt[]
  points:      Pt[]
  incident?:   Place | null
  destination?: Place | null
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleString('fr-BE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

export default function MissionRouteMap({ gmKey, pings, points, incident, destination }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<any>(null)
  const overlaysRef  = useRef<any[]>([])
  const infoRef      = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const { theme } = useTheme()

  // Init carte
  useEffect(() => {
    if (!containerRef.current || !gmKey) return
    let cancelled = false
    loadGoogleMaps(gmKey).then(() => {
      if (cancelled || mapRef.current) return
      const google = (window as any).google
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom:   DEFAULT_ZOOM,
        styles: theme === 'dark' ? DARK_MAP_STYLES : LIGHT_MAP_STYLES,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
      infoRef.current = new google.maps.InfoWindow({ pixelOffset: new google.maps.Size(0, -8) })
      setReady(true)
    }).catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmKey])

  // Thème à chaud
  useEffect(() => {
    if (!ready || !mapRef.current) return
    mapRef.current.setOptions({ styles: theme === 'dark' ? DARK_MAP_STYLES : LIGHT_MAP_STYLES })
  }, [theme, ready])

  // Tracé + marqueurs
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const google = (window as any).google
    if (!google) return

    overlaysRef.current.forEach(o => o.setMap(null))
    overlaysRef.current = []

    const bounds = new google.maps.LatLngBounds()
    let added = 0

    // Polyline du trajet (pings ordonnés)
    const path = pings.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    if (path.length >= 2) {
      const line = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#dc2626',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map: mapRef.current,
      })
      overlaysRef.current.push(line)
      path.forEach(pt => { bounds.extend(pt); added++ })
    } else {
      path.forEach(pt => { bounds.extend(pt); added++ })
    }

    const addMarker = (
      lat: number, lng: number, color: string, label: string,
      detail: string, scale = 8, square = false,
    ) => {
      const marker = new google.maps.Marker({
        position: { lat, lng },
        map: mapRef.current,
        title: label,
        icon: {
          path: square ? google.maps.SymbolPath.BACKWARD_CLOSED_ARROW : google.maps.SymbolPath.CIRCLE,
          scale, fillColor: color, fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 2,
        },
        zIndex: 100,
      })
      marker.addListener('click', () => {
        infoRef.current.setContent(
          `<div style="font-family:system-ui,sans-serif;padding:2px;min-width:140px;">
             <div style="font-weight:700;font-size:13px;color:#111;">${label}</div>
             ${detail ? `<div style="font-size:11px;color:#555;margin-top:2px;">${detail}</div>` : ''}
           </div>`
        )
        infoRef.current.open(mapRef.current, marker)
      })
      overlaysRef.current.push(marker)
      bounds.extend(marker.getPosition())
      added++
    }

    // Lieu d'intervention (losange gris) + destination (losange bleu)
    if (incident)    addMarker(incident.lat, incident.lng, '#6b7280', 'Lieu d\'intervention', incident.address || '', 6, true)
    if (destination) addMarker(destination.lat, destination.lng, '#0ea5e9', 'Destination', destination.address || '', 6, true)

    // Marqueurs de pointage
    points.forEach(p => {
      const meta = POINT_META[p.kind] || { label: p.kind, color: '#71717a' }
      addMarker(Number(p.lat), Number(p.lng), meta.color, meta.label, `📍 pointé ${hhmm(p.recorded_at)}`, 9)
    })

    if (added > 1)      mapRef.current.fitBounds(bounds, 60)
    else if (added === 1) { mapRef.current.setCenter(bounds.getCenter()); mapRef.current.setZoom(14) }
  }, [ready, pings, points, incident, destination])

  const empty = pings.length === 0 && points.length === 0 && !incident

  return (
    <div className="relative w-full h-[360px] rounded-xl overflow-hidden border">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-page">
          <p className="text-ink-muted text-sm">⏳ Chargement de la carte…</p>
        </div>
      )}
      {ready && empty && (
        <div className="absolute inset-0 flex items-center justify-center bg-page/80 pointer-events-none">
          <p className="text-ink-muted text-sm text-center px-6">Aucune position enregistrée pour cette mission.<br/>Le trajet apparaîtra dès que le chauffeur sera en route.</p>
        </div>
      )}
    </div>
  )
}

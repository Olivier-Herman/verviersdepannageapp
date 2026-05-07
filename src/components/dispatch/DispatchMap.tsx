'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'
import { useTheme } from '@/components/theme/ThemeProvider'

// Style sombre pour la carte Google Maps (matche le thème dark de l'app).
// Les couleurs sont alignées sur les tokens dark : bg-page #1A1614, surface
// #24201D, etc. — mais doivent être en hex direct (l'API Google Maps ne lit
// pas les CSS vars).
const DARK_MAP_STYLES: any[] =[
  { elementType: 'geometry',          stylers: [{ color: '#1A1A1A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F0F0F' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#9ca3af' }] },
  { featureType: 'water',                                stylers: [{ color: '#0a2540' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'poi',                                   stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',                               stylers: [{ visibility: 'off' }] },
]

// Style clair = défaut Google Maps (palette naturelle). Quickfix simple ;
// le polish (saturation réduite, teinte chaude pour matcher #FAF8F5) sera
// fait dans une session UX dédiée plus tard.
const LIGHT_MAP_STYLES: any[] =[]

// Couleurs pins missions par état
const MISSION_PIN_COLOR: Record<string, string> = {
  new:         '#dc2626',  // rouge — en commande
  dispatching: '#f59e0b',  // ambre — en attente assignation
  assigned:    '#3b82f6',  // bleu — assignée
  accepted:    '#3b82f6',
  in_progress: '#f97316',  // orange — en cours
  parked:      '#a855f7',  // violet — en parc
  completed:   '#16a34a',  // vert — terminée
}

// Couleurs pins chauffeurs par statut
const DRIVER_PIN_COLOR: Record<string, string> = {
  en_mission:   '#f97316',  // orange
  en_service:   '#16a34a',  // vert
  hors_service: '#71717a',  // gris
}

// Centre par défaut : Verviers
const DEFAULT_CENTER = { lat: 50.5912, lng: 5.8623 }
const DEFAULT_ZOOM   = 11

export interface MapMission {
  id:                  string
  status:              string
  source:              string
  mission_type:        string | null
  client_name:         string | null
  vehicle_plate:       string | null
  incident_address:    string | null
  incident_city:       string | null
  incident_lat:        number | null
  incident_lng:        number | null
  assigned_user?:      { id: string; name: string } | null
}

export interface MapDriver {
  id:     string
  name:   string
  status: string
  lat:    number | null
  lng:    number | null
}

interface Props {
  missions:   MapMission[]
  drivers:    MapDriver[]
  gmKey:      string
  onMissionClick?: (mission: MapMission) => void
  onDriverClick?:  (driver: MapDriver) => void
}

export default function DispatchMap({ missions, drivers, gmKey, onMissionClick, onDriverClick }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef          = useRef<any>(null)
  const markersRef      = useRef<any[]>([])
  const infoWindowRef   = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const { theme } = useTheme()

  // Initialise la carte (au mount uniquement — le thème est appliqué à l'init
  // depuis le state actuel et ré-appliqué via setOptions dans l'effect ci-dessous).
  useEffect(() => {
    if (!mapContainerRef.current || !gmKey) return
    let cancelled = false
    loadGoogleMaps(gmKey).then(() => {
      if (cancelled || mapRef.current) return
      const google = (window as any).google
      mapRef.current = new google.maps.Map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom:   DEFAULT_ZOOM,
        styles: theme === 'dark' ? DARK_MAP_STYLES : LIGHT_MAP_STYLES,
        disableDefaultUI: false,
        mapTypeControl:   false,
        streetViewControl: false,
      })
      infoWindowRef.current = new google.maps.InfoWindow({ pixelOffset: new google.maps.Size(0, -10) })
      setReady(true)
    }).catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmKey])

  // Re-render live du style quand le thème toggle (sans remount). Google Maps
  // supporte setOptions({ styles }) à chaud — pas de flash visible, le style
  // est ré-appliqué instantanément.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    mapRef.current.setOptions({
      styles: theme === 'dark' ? DARK_MAP_STYLES : LIGHT_MAP_STYLES,
    })
  }, [theme, ready])

  // Re-render markers à chaque changement
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const google = (window as any).google
    if (!google) return

    // Cleanup anciens markers
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    const bounds = new google.maps.LatLngBounds()
    let added = 0

    // Pins missions
    missions.forEach(mi => {
      if (mi.incident_lat == null || mi.incident_lng == null) return
      const color = MISSION_PIN_COLOR[mi.status] || '#71717a'
      const marker = new google.maps.Marker({
        position: { lat: Number(mi.incident_lat), lng: Number(mi.incident_lng) },
        map:      mapRef.current,
        title:    `${mi.client_name || '?'} · ${mi.vehicle_plate || ''}`,
        icon: {
          path:        google.maps.SymbolPath.CIRCLE,
          scale:       9,
          fillColor:   color,
          fillOpacity: 0.95,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: mi.status === 'new' ? 100 : 50,
      })
      marker.addListener('click', () => {
        // Dedup ville si déjà présente dans l'adresse (ex: "Rue X, 4900 Spa" + city "Spa")
        const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const addr = mi.incident_address || ''
        const city = mi.incident_city || ''
        const fullAddr = city && !norm(addr).includes(norm(city))
          ? [addr, city].filter(Boolean).join(', ')
          : addr || city || '—'

        const STATUS_LABEL: Record<string, string> = {
          new: 'En commande', dispatching: 'En attente', assigned: 'Assignée',
          accepted: 'Acceptée', in_progress: 'En cours',
          parked: 'En parc', delivering: 'En livraison', completed: 'Terminée',
        }
        const STATUS_COLOR: Record<string, string> = {
          new: '#dc2626', dispatching: '#f59e0b', assigned: '#3b82f6',
          accepted: '#3b82f6', in_progress: '#f97316',
          parked: '#a855f7', delivering: '#0ea5e9', completed: '#16a34a',
        }
        const statusLbl = STATUS_LABEL[mi.status] || mi.status
        const statusCol = STATUS_COLOR[mi.status] || '#71717a'
        const typeLbl = mi.mission_type
          ? mi.mission_type.charAt(0).toUpperCase() + mi.mission_type.slice(1)
          : ''

        const html = `
          <div style="font-family: system-ui, -apple-system, sans-serif; padding:4px 2px; min-width:220px; max-width:280px;">
            <div style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;">
              <span style="background:${statusCol}; color:#fff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.3px;">${statusLbl}</span>
              <span style="background:#f3f4f6; color:#374151; font-size:10px; font-weight:600; padding:2px 8px; border-radius:6px; text-transform:uppercase;">${mi.source}</span>
              ${typeLbl ? `<span style="background:#f3f4f6; color:#374151; font-size:10px; font-weight:600; padding:2px 8px; border-radius:6px;">${typeLbl}</span>` : ''}
            </div>
            <div style="font-weight:600; font-size:14px; color:#111827; margin-bottom:2px;">${mi.client_name || 'Client inconnu'}</div>
            ${mi.vehicle_plate ? `<div style="font-size:12px; color:#6b7280; font-family: ui-monospace, monospace; font-weight:600; margin-bottom:6px;">${mi.vehicle_plate}</div>` : ''}
            <div style="font-size:12px; color:#4b5563; margin-bottom:8px; line-height:1.4;">📍 ${fullAddr}</div>
            ${mi.assigned_user ? `<div style="font-size:11px; color:#059669; margin-bottom:8px;">🚛 ${mi.assigned_user.name}</div>` : ''}
            <div style="border-top:1px solid #e5e7eb; padding-top:8px; display:flex; gap:6px;">
              <button id="mp-open-${mi.id}" style="flex:1; background:#dc2626; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Ouvrir la fiche →</button>
            </div>
          </div>`
        infoWindowRef.current.setContent(html)
        infoWindowRef.current.open(mapRef.current, marker)
        google.maps.event.addListenerOnce(infoWindowRef.current, 'domready', () => {
          const el = document.getElementById(`mp-open-${mi.id}`)
          if (el) el.onclick = () => onMissionClick?.(mi)
        })
      })
      markersRef.current.push(marker)
      bounds.extend(marker.getPosition())
      added++
    })

    // Pins chauffeurs
    drivers.forEach(dr => {
      if (dr.lat == null || dr.lng == null) return
      const color = DRIVER_PIN_COLOR[dr.status] || '#71717a'
      // Pin custom : pictogramme camion sur fond coloré
      const marker = new google.maps.Marker({
        position: { lat: Number(dr.lat), lng: Number(dr.lng) },
        map:      mapRef.current,
        title:    `${dr.name} (${dr.status})`,
        icon: {
          path:         'M -8,-2 L 8,-2 L 8,2 L -8,2 Z M -10,-4 L -8,-4 L -8,4 L -10,4 Z M 10,-2 L 12,-2 L 12,4 L 10,4 Z',
          scale:        1.8,
          fillColor:    color,
          fillOpacity:  1,
          strokeColor:  '#fff',
          strokeWeight: 1.5,
          rotation:     0,
        },
        label: {
          text:      dr.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color:     '#fff',
          fontSize:  '10px',
          fontWeight: 'bold',
        },
        zIndex: 200,
      })
      marker.addListener('click', () => {
        const statusLbl = dr.status === 'en_mission' ? 'En mission'
                       : dr.status === 'en_service' ? 'En service' : 'Hors service'
        const statusCol = dr.status === 'en_mission' ? '#f97316'
                       : dr.status === 'en_service' ? '#16a34a' : '#71717a'
        const html = `
          <div style="font-family: system-ui, -apple-system, sans-serif; padding:4px 2px; min-width:180px;">
            <div style="font-weight:600; font-size:14px; color:#111827; margin-bottom:6px;">🚛 ${dr.name}</div>
            <span style="background:${statusCol}; color:#fff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; text-transform:uppercase;">${statusLbl}</span>
          </div>`
        infoWindowRef.current.setContent(html)
        infoWindowRef.current.open(mapRef.current, marker)
        onDriverClick?.(dr)
      })
      markersRef.current.push(marker)
      bounds.extend(marker.getPosition())
      added++
    })

    // Auto-fit si plusieurs pins, sinon centre par défaut
    if (added > 1) {
      mapRef.current.fitBounds(bounds, 80)
    } else if (added === 1) {
      mapRef.current.setCenter(bounds.getCenter())
      mapRef.current.setZoom(13)
    }
  }, [ready, missions, drivers, onMissionClick, onDriverClick])

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-page">
          <p className="text-ink-muted text-sm">⏳ Chargement de la carte…</p>
        </div>
      )}
      {/* Légende — fond suit le thème, puces colorées = palette métier des pins. */}
      <div className="absolute bottom-4 left-4 bg-surface/95 backdrop-blur border rounded-xl p-3 text-xs space-y-1.5 shadow-md">
        <p className="text-ink-muted font-semibold uppercase tracking-wide text-[10px] mb-1">Missions</p>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-600"></span><span className="text-ink-secondary">En commande</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500"></span><span className="text-ink-secondary">En attente</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span><span className="text-ink-secondary">Assignée</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span><span className="text-ink-secondary">En cours</span></div>
        <p className="text-ink-muted font-semibold uppercase tracking-wide text-[10px] mt-2 mb-1">Chauffeurs</p>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-ink-secondary">En service</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span><span className="text-ink-secondary">En mission</span></div>
      </div>
    </div>
  )
}

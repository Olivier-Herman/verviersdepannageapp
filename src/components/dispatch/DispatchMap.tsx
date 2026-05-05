'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'

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

  // Initialise la carte
  useEffect(() => {
    if (!mapContainerRef.current || !gmKey) return
    let cancelled = false
    loadGoogleMaps(gmKey).then(() => {
      if (cancelled || mapRef.current) return
      const google = (window as any).google
      mapRef.current = new google.maps.Map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom:   DEFAULT_ZOOM,
        styles: [  // Style sombre simplifié
          { elementType: 'geometry', stylers: [{ color: '#1A1A1A' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#0F0F0F' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
          { featureType: 'water', stylers: [{ color: '#0a2540' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
          { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#374151' }] },
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
        disableDefaultUI: false,
        mapTypeControl:   false,
        streetViewControl: false,
      })
      infoWindowRef.current = new google.maps.InfoWindow({ pixelOffset: new google.maps.Size(0, -10) })
      setReady(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [gmKey])

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
        const html = `
          <div style="color:#fff; font-family: system-ui; padding:6px; max-width:240px;">
            <div style="font-size:11px; opacity:0.7; margin-bottom:4px;">${mi.source.toUpperCase()} · ${mi.status}</div>
            <div style="font-weight:600; font-size:14px; margin-bottom:2px;">${mi.client_name || 'Client inconnu'}</div>
            <div style="font-size:12px; color:#d4d4d8;">${mi.vehicle_plate || ''}</div>
            <div style="font-size:11px; color:#9ca3af; margin-top:4px;">${[mi.incident_address, mi.incident_city].filter(Boolean).join(', ')}</div>
            ${mi.assigned_user ? `<div style="font-size:11px; color:#86efac; margin-top:4px;">→ ${mi.assigned_user.name}</div>` : ''}
            <div style="margin-top:8px; font-size:11px; color:#3b82f6; cursor:pointer;" id="mp-open-${mi.id}">Ouvrir la fiche →</div>
          </div>`
        infoWindowRef.current.setContent(html)
        infoWindowRef.current.open(mapRef.current, marker)
        // Hook click sur le lien dans l'info window
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
        const html = `
          <div style="color:#fff; font-family: system-ui; padding:6px;">
            <div style="font-weight:600; font-size:14px; margin-bottom:2px;">🚛 ${dr.name}</div>
            <div style="font-size:11px; color:#9ca3af;">${dr.status === 'en_mission' ? 'En mission' : dr.status === 'en_service' ? 'En service' : 'Hors service'}</div>
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
    <div className="relative w-full h-full bg-[#0F0F0F]">
      <div ref={mapContainerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0F0F0F]">
          <p className="text-zinc-500 text-sm">⏳ Chargement de la carte…</p>
        </div>
      )}
      {/* Légende */}
      <div className="absolute bottom-4 left-4 bg-[#1A1A1A]/95 backdrop-blur border border-[#2a2a2a] rounded-xl p-3 text-xs space-y-1.5">
        <p className="text-zinc-400 font-semibold uppercase tracking-wide text-[10px] mb-1">Missions</p>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-600"></span><span className="text-zinc-300">En commande</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500"></span><span className="text-zinc-300">En attente</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span><span className="text-zinc-300">Assignée</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span><span className="text-zinc-300">En cours</span></div>
        <p className="text-zinc-400 font-semibold uppercase tracking-wide text-[10px] mt-2 mb-1">Chauffeurs</p>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-zinc-300">En service</span></div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span><span className="text-zinc-300">En mission</span></div>
      </div>
    </div>
  )
}

'use client'
// Carte du nouveau Dispatch (étape 6, préversion dispatch_v2).
// Fond de carte libre (OpenStreetMap, via Leaflet) : aucun coût Google.
// Missions à la couleur de leur assistance, cerclées de rouge quand elles attendent un geste ;
// chauffeurs avec les mêmes états que l'écran actuel. Position d'un chauffeur = celle du
// téléphone, relevée seulement pendant une mission : un chauffeur libre peut ne pas apparaître.

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

type P = { id: string; lat: number; lng: number; couleur: string; texte: string; titre: string; urgent?: boolean }
type C = { id: string; lat: number; lng: number; initiales: string; titre: string; occupe: boolean }

export default function CarteDispatch({ missions, chauffeurs, onMission }: { missions: P[]; chauffeurs: C[]; onMission: (id: string) => void }) {
  const div = useRef<HTMLDivElement>(null)
  const carte = useRef<any>(null)
  const couche = useRef<any>(null)
  const cadre = useRef(false)
  const onMissionRef = useRef(onMission); onMissionRef.current = onMission

  useEffect(() => {
    let annule = false
    import('leaflet').then(L => {
      if (annule || !div.current || carte.current) return
      carte.current = L.map(div.current, { zoomControl: true, attributionControl: true }).setView([50.59, 5.86], 11)   // Verviers
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(carte.current)
      couche.current = L.layerGroup().addTo(carte.current)
      dessiner(L)
    })
    return () => { annule = true; if (carte.current) { carte.current.remove(); carte.current = null } }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { import('leaflet').then(L => dessiner(L)) })   // à chaque rafraîchissement des données

  function dessiner(L: any) {
    if (!carte.current || !couche.current) return
    couche.current.clearLayers()
    const points: [number, number][] = []
    for (const m of missions) {
      const ic = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
        html: `<div style="width:30px;height:30px;border-radius:50%;background:${m.couleur};border:${m.urgent ? '4px solid #dc2626' : '2px solid #fff'};box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:800 10px/22px Inter,system-ui,sans-serif;text-align:center">${m.texte}</div>` })
      L.marker([m.lat, m.lng], { icon: ic, title: m.titre }).on('click', () => onMissionRef.current(m.id)).addTo(couche.current)
      points.push([m.lat, m.lng])
    }
    for (const c of chauffeurs) {
      const ic = L.divIcon({ className: '', iconSize: [34, 24], iconAnchor: [17, 12],
        html: `<div style="width:34px;height:24px;border-radius:8px;background:${c.occupe ? '#b45309' : '#047857'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:800 11px/20px Inter,system-ui,sans-serif;text-align:center">${c.initiales}</div>` })
      L.marker([c.lat, c.lng], { icon: ic, title: c.titre }).addTo(couche.current)
      points.push([c.lat, c.lng])
    }
    // Cadrage une seule fois (ensuite on laisse l'utilisateur zoomer et se déplacer).
    if (!cadre.current && points.length) { carte.current.fitBounds(points, { padding: [30, 30], maxZoom: 13 }); cadre.current = true }
  }

  return <div ref={div} className="w-full h-[min(560px,calc(100vh-280px))] min-h-[320px] rounded-xl overflow-hidden border border-stone-200 z-0" />
}

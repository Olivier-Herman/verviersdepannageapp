'use client'
// src/components/dispatch/PointagesCard.tsx
//
// Tableau des POINTAGES d'une intervention — réservé aux superadmins
// (Olivier 2026-08-14).
//
// Chaque pointage du chauffeur (accepter, en route, sur place, chargé, mise en
// parc, terminer…) est déjà horodaté ET géolocalisé dans `mission_position_pings`.
// Jusqu'ici ces positions ne servaient qu'à tracer le trajet sur la carte. Or
// c'est la seule façon de savoir OÙ un pointage a réellement été fait : sur le
// dossier 2ERS242, « chargé » a été pointé à 800 m du garage de destination et
// non sur le lieu de la panne — le chauffeur avait roulé, il avait juste pointé
// à l'arrivée.
//
// L'adresse est résolue dans le NAVIGATEUR (règle maison : le géocodage ne passe
// jamais par le serveur), une fois par position, en série pour ne pas déclencher
// la limitation de Google.

import { useEffect, useState } from 'react'
import { reverseGeocodeCity } from '@/components/AddressField'

interface Ping { lat: number; lng: number; kind: string; recorded_at: string; address?: string | null }
interface Track {
  points: Ping[]
  /** Distances ROUTIÈRES (km) calculées par ORS, dans l'ordre des points. */
  road: { toIncident: (number | null)[]; toDestination: (number | null)[] } | null
  incident:    { lat: number; lng: number; address: string } | null
  destination: { lat: number; lng: number; address: string } | null
}

const LABELS: Record<string, string> = {
  accept:           'Accepté',
  on_way:           'En route',
  on_site:          'Sur place',
  load_vehicle:     'Véhicule chargé',
  start_delivery:   'Départ livraison',
  complete_delivery:'Arrivé à destination',
  park:             'Mise en parc',
  completed:        'Terminé',
}

const fmtKm = (d: number) => d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`

// Seuil d'alerte sur un « Terminé » : 300 m PAR LA ROUTE. À vol d'oiseau on est
// déjà très loin à 1 km — à Verviers, un garage et notre dépôt peuvent être
// voisins en ligne droite et distants par la route. Olivier 2026-08-14.
const SEUIL_KM = 0.3

export default function PointagesCard({ missionId, googleMapsKey }: { missionId: string; googleMapsKey: string }) {
  const [track, setTrack]   = useState<Track | null>(null)
  const [addrs, setAddrs]   = useState<Record<string, string>>({})
  const [open, setOpen]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!open || track) return
    let alive = true
    fetch(`/api/missions/${missionId}/route-track?road=1`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (alive) { if (d.error) setError(d.error); else setTrack(d) } })
      .catch(() => alive && setError('Impossible de charger les pointages'))
    return () => { alive = false }
  }, [open, missionId, track])

  // Résolution des adresses MANQUANTES seulement, une par une (Google n'aime pas
  // les rafales), puis on les mémorise en base : une position ne bouge jamais,
  // il n'y a aucune raison de la racheter à chaque ouverture de la fiche.
  // Olivier 2026-08-14.
  useEffect(() => {
    if (!track || !googleMapsKey) return
    let alive = true
    ;(async () => {
      const nouvelles: { lat: number; lng: number; address: string }[] = []
      for (const p of track.points) {
        if (p.address) continue                       // déjà connue → zéro appel
        const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
        if (addrs[key]) continue
        try {
          const r = await reverseGeocodeCity(p.lat, p.lng, googleMapsKey)
          if (!alive) return
          if (r?.formatted) {
            setAddrs(prev => ({ ...prev, [key]: r.formatted as string }))
            nouvelles.push({ lat: p.lat, lng: p.lng, address: r.formatted })
          }
        } catch { /* une adresse manquante n'empêche pas de lire le reste */ }
      }
      if (alive && nouvelles.length > 0) {
        fetch(`/api/missions/${missionId}/ping-address`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: nouvelles }),
        }).catch(() => { /* le cache est un bonus, pas une dépendance */ })
      }
    })()
    return () => { alive = false }
  }, [track, googleMapsKey, missionId])   // eslint-disable-line react-hooks/exhaustive-deps

  const hm = (s: string) => new Date(s).toLocaleTimeString('fr-BE', {
    timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="px-4 lg:px-8 pt-4">
      <div className="rounded-2xl border border bg-surface overflow-hidden">
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left">
          <span className="w-9 h-9 rounded-xl bg-ink/5 flex items-center justify-center text-lg flex-shrink-0">📍</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">Superadmin</p>
            <p className="text-ink font-bold leading-tight">Pointages du chauffeur</p>
          </div>
          <span className="text-ink-muted text-sm">{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <div className="border-t border">
            {error && <p className="px-4 py-3 text-sm text-red-500">{error}</p>}
            {!track && !error && <p className="px-4 py-3 text-sm text-ink-muted">Chargement…</p>}
            {track && track.points.length === 0 && (
              <p className="px-4 py-3 text-sm text-ink-muted">
                Aucune position enregistrée — le chauffeur n’a pas autorisé la localisation, ou les pointages sont antérieurs à cette fonction.
              </p>
            )}
            {track && track.points.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-ink-muted text-[11px] uppercase tracking-wide">
                      <th className="text-left font-bold px-4 py-2">Heure</th>
                      <th className="text-left font-bold px-2 py-2">Pointage</th>
                      <th className="text-left font-bold px-2 py-2">Position</th>
                      <th className="text-right font-bold px-2 py-2 whitespace-nowrap">Route → panne</th>
                      <th className="text-right font-bold px-4 py-2 whitespace-nowrap">Route → destination</th>
                    </tr>
                  </thead>
                  <tbody>
                    {track.points.map((p, i) => {
                      const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
                      const dInc = track.road?.toIncident?.[i] ?? null
                      const dDst = track.road?.toDestination?.[i] ?? null
                      // Un « terminé » loin de la destination mérite l'œil.
                      const suspect = p.kind === 'completed' && dDst != null && dDst > SEUIL_KM
                      return (
                        <tr key={i} className="border-t border">
                          <td className="px-4 py-2.5 tabular-nums text-ink-secondary whitespace-nowrap">{hm(p.recorded_at)}</td>
                          <td className="px-2 py-2.5 font-semibold text-ink whitespace-nowrap">
                            {LABELS[p.kind] || p.kind}
                          </td>
                          <td className="px-2 py-2.5 text-ink-secondary">
                            {p.address || addrs[key] || <span className="text-ink-faint tabular-nums">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>}
                            <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noopener"
                              className="ml-2 text-ink-muted hover:text-ink">↗</a>
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-ink-muted whitespace-nowrap">
                            {dInc != null ? fmtKm(dInc) : '—'}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${suspect ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-ink-muted'}`}>
                            {dDst != null ? fmtKm(dDst) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="px-4 py-2.5 text-[11.5px] text-ink-muted border-t border">
                  Distances <b>par la route</b> (pas à vol d’oiseau). Un « Terminé » à plus de 300 m de la destination
                  est surligné — souvent parce que le pointage a été fait ailleurs, pas parce que le véhicule est ailleurs.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// src/lib/depots/nearest.ts
//
// Sélection du dépôt VD le plus proche d'un point + assignation automatique du
// dépôt de départ pour les missions Touring (le dépôt le plus proche du lieu
// d'intervention détermine le dépôt de tout le dossier). Olivier 2026-06-29.

import { createAdminClient } from '@/lib/supabase'

export interface NearestDepot { id: string; name: string; lat: number; lng: number; distanceKm: number }

/** Distance à vol d'oiseau (suffisant pour départager des dépôts). */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Dépôt VD actif le plus proche d'un point (par haversine). */
export async function findNearestDepot(lat: number, lng: number, sb?: any): Promise<NearestDepot | null> {
  const db = sb || createAdminClient()
  const { data: depots } = await db.from('depots').select('id, name, lat, lng').eq('active', true)
  let best: NearestDepot | null = null
  for (const d of depots || []) {
    if (d.lat == null || d.lng == null) continue
    const dist = haversineKm(lat, lng, Number(d.lat), Number(d.lng))
    if (!best || dist < best.distanceKm) {
      best = { id: d.id, name: d.name, lat: Number(d.lat), lng: Number(d.lng), distanceKm: dist }
    }
  }
  return best
}

/**
 * Touring : pose `depot_depart_id` = dépôt le plus proche du lieu d'intervention
 * s'il n'est pas encore renseigné. Mute la mission en mémoire (depot_depart_id)
 * et persiste en base. Retourne le dépôt retenu (ou null si non applicable).
 * Idempotent et non bloquant.
 */
export async function ensureTouringDepartDepot(sb: any, mission: any): Promise<NearestDepot | null> {
  if (!mission || String(mission.source || '').toLowerCase().trim() !== 'touring') return null
  if (mission.incident_lat == null || mission.incident_lng == null) return null
  const nearest = await findNearestDepot(Number(mission.incident_lat), Number(mission.incident_lng), sb)
  if (!nearest) return null
  // On ne remplit que si vide (on respecte un choix manuel existant du dispatcher).
  if (!mission.depot_depart_id) {
    try {
      await sb.from('incoming_missions').update({ depot_depart_id: nearest.id }).eq('id', mission.id)
      mission.depot_depart_id = nearest.id
    } catch { /* non bloquant */ }
  }
  return nearest
}

// src/lib/touring/address-change-check.ts — une nouvelle action Touring rattachée à une
// fiche en cours porte-t-elle une AUTRE adresse de livraison ? (Olivier 05/10/2026, 2DTV183)
// Seulement si la fiche avait déjà une destination et n'est pas au parc (une REM au dépôt
// qui reçoit l'action de transfert n'est pas un « changement »). Cf lib/missions/address-change.
import { mapComexToMission } from './map-mission'
import { flagAddressChange } from '@/lib/missions/address-change'

export async function touringAddressChangeCheck(sb: any, lin: { id: string; status?: string | null; destination_address?: string | null }, detail: Record<string, any>, ref: string, cidDos: string): Promise<boolean> {
  if (!String(lin.destination_address || '').trim()) return false
  if (['parked', 'gardiennage'].includes(String(lin.status || ''))) return false
  const m = mapComexToMission({ detail, status: 'new', billedToId: null, billedToName: null })
  const address = String(m.destination_address || '').trim()
  if (!address) return false
  return flagAddressChange(sb, lin.id, { address, name: m.destination_name || null, lat: m.destination_lat ?? null, lng: m.destination_lng ?? null }, { source: 'Touring', ref: `${cidDos} · commande ${ref}` })
}

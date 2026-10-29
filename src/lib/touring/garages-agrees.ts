// src/lib/touring/garages-agrees.ts — destination « réseau agréé » d'une mission Touring (Olivier 29/10/2026).
//
// Touring écrit parfois une destination générique (« centrale de pneu », destination « Réseau agréé – Erkend
// netwerk ») : le véhicule doit aller chez un garage DE LEUR LISTE, pas chez la société qui s'appelle « Centrale de
// pneus ». La liste est celle de COMEX (provider/get, la même qu'à la clôture), filtrée par les codes de panne de la
// mission et triée par distance. On la propose au chauffeur : d'abord le garage indiqué par Touring s'il y en a un,
// puis les plus proches. Le choix est retenu (journal
// « touring_garage_choisi ») et repris à la clôture.

import { loginComex, getComexProviders, type ComexProvider } from '@/lib/touring/comex'
import { parseComexKeys } from '@/lib/cloture/transform/touring'

export interface GarageAgree { label: string; lat: number; lng: number; cidPrx: string; nom: string; demande: boolean; km: number; localite: string }

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** La fiche Touring attend un garage du réseau agréé (destination générique), et aucun n'est encore choisi. */
export function destinationReseauAgree(m: { raw_content?: string | null; destination_name?: string | null; destination_address?: string | null }): boolean {
  if (!parseComexKeys(m.raw_content)) return false
  return /r[ée]seau agr[ée]|erkend/i.test(String(m.destination_name || '')) || /^\s*(centrale|garage|r[ée]parateur)s?\b.{0,20}$/i.test(String(m.destination_address || ''))
}

/** Codes de panne de la mission (action COMEX stockée sur la fiche). */
function codesPanne(m: any): { cause: string; desc: string; result: string } {
  for (const a of Array.isArray(m.touring_actions) ? m.touring_actions : []) {
    try {
      const r = typeof a?.raw === 'string' ? JSON.parse(a.raw) : (a?.raw || a)
      if (r?.COD_PANNE_CAUSE) return { cause: String(r.COD_PANNE_CAUSE), desc: String(r.COD_PANNE_DESC || ''), result: String(r.COD_PANNE_RESULT || '') }
    } catch { /* action illisible */ }
  }
  return { cause: '', desc: '', result: '' }
}

/** Garage indiqué par Touring dans l'action (TO_NOM / TO_CP / TO_RUE), s'il y en a un. */
function toGarage(m: any): { nom: string; cp: string; rue: string } | null {
  for (const a of Array.isArray(m.touring_actions) ? m.touring_actions : []) {
    try {
      const r = typeof a?.raw === 'string' ? JSON.parse(a.raw) : (a?.raw || a)
      if (r?.TO_NOM || r?.TO_RUE) return { nom: norm(r.TO_NOM || ''), cp: String(r.TO_CP || ''), rue: norm(r.TO_RUE || '') }
    } catch { /* action illisible */ }
  }
  return null
}

/** Garages agréés à proposer (au plus `max`) : celui indiqué par Touring d'abord, puis les plus proches. */
export async function garagesAgrees(m: any, max = 4): Promise<GarageAgree[]> {
  const keys = parseComexKeys(m.raw_content)
  if (!keys) return []
  const liste: ComexProvider[] = await getComexProviders(await loginComex('user'), keys, codesPanne(m))
  const valides = liste.filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Number(p.lat) !== 0)
  // Garage désigné par Touring lui-même (champs TO_* de l'action, rarement remplis) : en tête. Jamais deviné dans la
  // description : « bk 22,2 >> battice » est le SENS DE CIRCULATION sur l'autoroute, pas un souhait du client
  // (Olivier 29/10/2026, 2HGW277).
  const to = toGarage(m)
  const demandes = to ? valides.filter(p => (to.nom && norm(p.nom) === to.nom) || (to.cp && p.cp === to.cp && to.rue && norm(p.rue).includes(to.rue))) : []
  const tri = [...demandes, ...valides.filter(p => !demandes.includes(p))].slice(0, max)
  return tri.map(p => ({
    cidPrx: p.cidPrx, nom: p.nom, lat: Number(p.lat), lng: Number(p.lng), demande: demandes.includes(p), km: Number(p.distance) || 0, localite: p.localite,
    label: `${p.nom}, ${[p.rue, p.numRue].filter(Boolean).join(' ')}, ${p.cp} ${p.localite}`.replace(/\s+,/g, ','),
  }))
}

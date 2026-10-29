// src/lib/touring/garages-agrees.ts — destination « réseau agréé » d'une mission Touring (Olivier 29/10/2026).
//
// Touring écrit parfois une destination générique (« centrale de pneu », destination « Réseau agréé – Erkend
// netwerk ») : le véhicule doit aller chez un garage DE LEUR LISTE, pas chez la société qui s'appelle « Centrale de
// pneus ». La liste est celle de COMEX (provider/get, la même qu'à la clôture), filtrée par les codes de panne de la
// mission et triée par distance. On la propose au chauffeur : d'abord le garage que le client a demandé quand Touring
// l'a noté dans la description (« >> battice »), puis les plus proches. Le choix est retenu (journal
// « touring_garage_choisi ») et repris à la clôture.

import { loginComex, getComexProviders, type ComexProvider } from '@/lib/touring/comex'
import { parseComexKeys } from '@/lib/cloture/transform/touring'

export interface GarageAgree { label: string; lat: number; lng: number; cidPrx: string; nom: string; demande: boolean }

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

/** Garages agréés à proposer (au plus `max`) : celui que demande le client d'abord, puis les plus proches. */
export async function garagesAgrees(m: any, max = 4): Promise<GarageAgree[]> {
  const keys = parseComexKeys(m.raw_content)
  if (!keys) return []
  const liste: ComexProvider[] = await getComexProviders(await loginComex('user'), keys, codesPanne(m))
  const valides = liste.filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Number(p.lat) !== 0)
  // « >> battice », « vers Battice » : la commune voulue par le client, notée par Touring.
  const voulu = norm(String(m.incident_description || '').match(/(?:>>|\bvers\b)\s*([a-zà-ÿ' -]{3,40})/i)?.[1] || '').trim()
  const demandes = voulu ? valides.filter(p => norm(p.localite).includes(voulu) || voulu.includes(norm(p.localite)) || norm(p.nom).includes(voulu)) : []
  const tri = [...demandes, ...valides.filter(p => !demandes.includes(p))].slice(0, max)
  return tri.map(p => ({
    cidPrx: p.cidPrx, nom: p.nom, lat: Number(p.lat), lng: Number(p.lng), demande: demandes.includes(p),
    label: `${p.nom}, ${[p.rue, p.numRue].filter(Boolean).join(' ')}, ${p.cp} ${p.localite}`.replace(/\s+,/g, ','),
  }))
}

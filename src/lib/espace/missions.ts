// src/lib/espace/missions.ts
//
// Ce que voit un compte de l'espace client (Olivier 10/10/2026) :
//   - société et gestionnaire : toutes les missions FACTURÉES à leurs sociétés (billed_to_id), quelle que soit la source ;
//   - collaborateur : seulement les missions qu'il a commandées lui-même depuis l'espace.
// Les volets internes (gardiennage, relivraison rattachée) ne s'affichent pas seuls : la relivraison
// complète la frise de sa mission.

import { createAdminClient } from '@/lib/supabase'
import { isDsp, isRemorquage, isRelivraison } from '@/lib/missions/mission-types'
import type { EspaceCompte, EspaceSociete } from './session'

export const MISSION_COLS = 'id, mission_number, status, mission_type, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, destination_address, destination_name, received_at, rdv_at, assigned_at, accepted_at, on_way_at, on_site_at, loaded_at, parked_at, delivering_at, completed_at, cancelled_at, billed_to_id, billed_to_name, espace_compte_id, invoice_odoo_id, odoo_quote_id, remarks_general, client_phone, dossier_number, parent_mission_id, created_at'

export function scopeMissions(q: any, compte: EspaceCompte, societes: EspaceSociete[]) {
  q = q.in('billed_to_id', societes.map(s => s.odoo_partner_id))
    .is('parent_mission_id', null)
    .neq('source', 'gardiennage')
    .not('status', 'in', '(ignored,parse_error)')
    .or('dossier_leg.is.null,dossier_leg.eq.false')
  if (compte.role === 'collaborateur') q = q.eq('espace_compte_id', compte.id)
  return q
}

export async function missionVisible(id: string, compte: EspaceCompte, societes: EspaceSociete[]): Promise<any | null> {
  const sb = createAdminClient()
  const { data } = await scopeMissions(sb.from('incoming_missions').select(MISSION_COLS), compte, societes).eq('id', id).maybeSingle()
  return data || null
}

export interface Etape { cle: string; libelle: string; quand: string | null; faite: boolean; courante: boolean }
export interface Suivi { statut: string; libelle: string; ton: 'attente' | 'accepte' | 'route' | 'action' | 'fini' | 'annule'; etapes: Etape[]; type: 'DSP' | 'REM' | 'REM+REL' | 'AUTRE'; termineeLe: string | null }

const FINI = ['to_invoice', 'completed']

/** Frise vue par le client. `rel` = relivraison rattachée (REM vers notre dépôt puis livraison). */
export function suiviClient(m: any, rel?: any | null): Suivi {
  const type: Suivi['type'] = rel ? 'REM+REL' : isDsp(m.mission_type) ? 'DSP' : isRemorquage(m.mission_type) ? 'REM' : 'AUTRE'
  if (m.status === 'cancelled') {
    return { statut: 'annulee', libelle: 'Annulée', ton: 'annule', type, termineeLe: null,
      etapes: [{ cle: 'recue', libelle: 'Demande reçue', quand: m.received_at, faite: true, courante: false }, { cle: 'annulee', libelle: 'Annulée', quand: m.cancelled_at, faite: true, courante: true }] }
  }
  const acceptee = m.status !== 'new'
  const fin = rel ? (FINI.includes(rel.status) ? (rel.completed_at || rel.updated_at) : null) : (FINI.includes(m.status) ? m.completed_at : null)
  const e: Omit<Etape, 'courante'>[] = [
    { cle: 'recue', libelle: 'Demande reçue', quand: m.received_at || m.created_at, faite: true },
    { cle: 'acceptee', libelle: 'Acceptée', quand: m.assigned_at || m.accepted_at, faite: acceptee },
    { cle: 'en_route', libelle: 'En route', quand: m.on_way_at, faite: !!m.on_way_at || !!m.on_site_at || !!fin },
    { cle: 'sur_place', libelle: 'Sur place', quand: m.on_site_at, faite: !!m.on_site_at || !!fin },
  ]
  if (type === 'DSP') e.push({ cle: 'action', libelle: 'Dépannage sur place', quand: m.on_site_at, faite: !!fin })
  else if (type !== 'AUTRE') e.push({ cle: 'action', libelle: 'Remorquage', quand: m.loaded_at, faite: !!m.loaded_at || !!fin })
  if (rel) {
    e.push({ cle: 'depot', libelle: 'Au dépôt', quand: m.parked_at || m.completed_at, faite: !!m.parked_at || FINI.includes(m.status) || !!fin })
    e.push({ cle: 'relivraison', libelle: 'En livraison', quand: rel.on_way_at || rel.delivering_at, faite: !!rel.on_way_at || !!rel.delivering_at || !!fin })
  }
  e.push({ cle: 'terminee', libelle: 'Terminée', quand: fin, faite: !!fin })
  const idx = (() => { let i = 0; e.forEach((x, k) => { if (x.faite) i = k }); return i })()
  const etapes = e.map((x, k) => ({ ...x, courante: k === idx }))
  const cur = etapes[idx]
  const ton: Suivi['ton'] = cur.cle === 'terminee' ? 'fini' : cur.cle === 'recue' ? 'attente' : cur.cle === 'acceptee' ? 'accepte' : cur.cle === 'en_route' || cur.cle === 'relivraison' ? 'route' : 'action'
  const libelle = cur.cle === 'recue' ? 'En attente de validation' : cur.cle === 'action' && type === 'DSP' ? 'Dépannage en cours' : cur.cle === 'action' ? 'Remorquage en cours' : cur.libelle
  return { statut: cur.cle, libelle, ton, etapes, type, termineeLe: fin }
}

/** Relivraisons rattachées, par mission racine. */
export async function relivraisonsDe(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  if (!ids.length) return out
  const { data } = await createAdminClient().from('incoming_missions')
    .select('id, parent_mission_id, mission_type, status, on_way_at, delivering_at, completed_at, updated_at, destination_address, destination_name')
    .in('parent_mission_id', ids).neq('status', 'cancelled')
  for (const r of data || []) if (isRelivraison(r.mission_type) && !out.has(r.parent_mission_id)) out.set(r.parent_mission_id, r)
  return out
}

export const vehiculeLabel = (m: any) => [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')

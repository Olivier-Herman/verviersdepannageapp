// src/lib/vab/vr.ts — livraison de véhicule de remplacement (VR) VAB (Olivier 13/10/2026).
//
// VAB envoie pour un même dossier (partie avant le « / ») une action « Livraison véhicule de
// remplacement » (page DeliveryAssignments) et une action « Remorquage ». Règles d'Olivier :
//   • remorquage encore actif → la livraison devient des étapes de SA fiche : prise du VR chez le
//     concessionnaire, livraison chez le client, puis le remorquage. Tous les km comptés, forfait VR
//     ajouté (lib/facturation/vab-vr). VAB peut créer le VR bien après le remorquage.
//   • chauffeur déjà arrivé chez le client (ou plus loin) → on rattache quand même et on POSE LA
//     QUESTION au dispatch et au chauffeur ; leur choix remet les étapes dans l'ordre réel.
//   • remorquage déjà clôturé (ou absent) → mission à part, forfait VR + tous les km.
// Les pointages et la clôture VAB restent sur l'action REMORQUAGE (external_id) : la livraison VR
// se clôture à la main dans Comet tant que son écran chauffeur n'existe pas.

import type { VabMissionDetail } from './scraper'

/** Une ligne VAB est une livraison de VR : page Delivery, ou type « … remplacement » dans la liste. */
export function estLivraisonVr(detailHref: string | null | undefined, typeLabel?: string | null): boolean {
  return /DeliveryAssignments/i.test(String(detailHref || '')) || /remplacement|vervangwagen|replacement/i.test(String(typeLabel || ''))
}

export type VrPlacement = 'before' | 'after' | 'to_decide'

export interface VabVr {
  aid:        string
  dossier:    string
  plate:      string | null
  pickup:     { name: string | null; address: string | null; lat: number | null; lng: number | null }
  deliver:    { name: string | null; address: string | null; phone: string | null }
  placement:  VrPlacement
  standalone: boolean
  added_at:   string
  delivered_at?: string | null
}

/** Statuts où le chauffeur est déjà chez le client ou au-delà : l'ordre des étapes se décide avec lui. */
const DEJA_SUR_PLACE = ['on_site', 'loaded', 'in_progress', 'delivering']
/** Voiture déjà déposée (garage ou parc) : la mission est finie, la livraison VR devient une nouvelle mission (Olivier 13/10/2026). */
export const DEJA_DEPOSE = ['parked', 'gardiennage', 'completed', 'to_invoice']

export async function vrDepuisDetail(detail: VabMissionDetail, aid: string, dossier: string, standalone: boolean): Promise<VabVr> {
  const pickupAddr = [detail.fromStreet, [detail.fromZip, detail.fromCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
  let lat: number | null = null, lng: number | null = null
  if (pickupAddr) {
    try {
      const { geocodeAddressServer } = await import('@/lib/geocode/server')
      const hit: any = await geocodeAddressServer(pickupAddr)
      if (hit?.lat != null && hit?.lng != null) { lat = Number(hit.lat); lng = Number(hit.lng) }
    } catch { /* sans coordonnées, le km manquera : la fiche le signalera « à calculer » */ }
  }
  return {
    aid, dossier,
    plate: detail.vehiclePlate?.replace(/\s/g, '').toUpperCase() || null,
    pickup: { name: detail.fromName, address: pickupAddr, lat, lng },
    deliver: { name: detail.toName, address: [detail.toStreet, [detail.toZip, detail.toCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, phone: detail.toPhone },
    placement: 'before', standalone, added_at: new Date().toISOString(),
  }
}

/**
 * Rattache une livraison de VR à la fiche remorquage active du même dossier. Renvoie le placement
 * retenu ; prévient le chauffeur, et pose la question (dispatch + chauffeur) s'il est déjà sur place.
 */
export async function rattacherVr(sb: any, fiche: any, vr: VabVr): Promise<VrPlacement> {
  const placement: VrPlacement = DEJA_SUR_PLACE.includes(String(fiche.status)) ? 'to_decide' : 'before'
  const ids: string[] = Array.isArray(fiche.vab_assignment_ids) ? fiche.vab_assignment_ids : []
  await sb.from('incoming_missions').update({
    vab_vr: { ...vr, placement, standalone: false },
    vab_assignment_ids: ids.includes(vr.aid) ? ids : [...ids, vr.aid],
    updated_at: new Date().toISOString(),
  }).eq('id', fiche.id)
  const quoi = `véhicule de remplacement ${vr.plate || ''} à prendre chez ${vr.pickup.name || vr.pickup.address || 'le concessionnaire'} et à livrer chez le client`.replace(/\s+/g, ' ')
  await sb.from('mission_logs').insert({
    mission_id: fiche.id, action: 'vab_vr_rattache',
    notes: placement === 'before'
      ? `VAB : ${quoi} — ajouté à la mission AVANT la prise en charge (action ${vr.aid}, dossier ${vr.dossier}).`
      : `VAB : ${quoi} — demande arrivée alors que le chauffeur est déjà chez le client : ordre des étapes à décider (action ${vr.aid}).`,
    metadata: { assignmentId: vr.aid, dossier: vr.dossier, placement, auto: true },
  }).then(() => {}, () => {})
  try {
    const { sendPushToUser, sendPushToRole } = await import('@/lib/push')
    const num = fiche.mission_number ? `#${fiche.mission_number}` : ''
    if (fiche.assigned_to) await sendPushToUser(fiche.assigned_to, {
      title: placement === 'before' ? '🚗 Véhicule de remplacement à livrer' : '🚗 Véhicule de remplacement : comment tu t’organises ?',
      body: placement === 'before'
        ? `Mission ${num} : passe d’abord prendre le ${vr.plate || 'véhicule de remplacement'} chez ${vr.pickup.name || 'le concessionnaire'}, puis livre-le chez le client.`
        : `Mission ${num} : VAB demande aussi la livraison du ${vr.plate || 'véhicule de remplacement'} (${vr.pickup.name || 'concessionnaire'}). Vois avec le dispatch dans quel ordre tu le fais.`,
      url: `/mission/${fiche.id}`,
    })
    if (placement === 'to_decide') await sendPushToRole(['dispatcher', 'admin', 'superadmin'], {
      title: '🚗 Véhicule de remplacement à organiser',
      body: `Mission ${num} ${fiche.vehicle_plate || ''} : le chauffeur est déjà chez le client. Décider avec lui : livraison après le dépôt de la voiture, ou mission séparée.`.replace(/\s+/g, ' '),
      url: `/dispatch`,
    })
  } catch { /* notification = un plus */ }
  return placement
}

/**
 * Le remorquage arrive après une livraison de VR déjà créée en fiche seule et pas encore partie :
 * on la fond dans la nouvelle fiche remorquage (étape avant la prise en charge) et on écarte la fiche VR.
 */
export async function fondreVrSeul(sb: any, remFiche: any, dossierBase: string): Promise<boolean> {
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, status, vab_vr, vab_assignment_ids')
    .not('vab_vr', 'is', null)
    .or(`dossier_number.ilike.${dossierBase}/%,dossier_number.eq.${dossierBase}`)
    .in('status', ['new', 'dispatching'])
    .neq('id', remFiche.id)
  const seul = (rows || []).find((r: any) => r.vab_vr?.standalone)
  if (!seul) return false
  const { data: rem } = await sb.from('incoming_missions').select('id, status, mission_number, assigned_to, vehicle_plate, vab_assignment_ids').eq('id', remFiche.id).single()
  await rattacherVr(sb, rem, { ...seul.vab_vr, standalone: false })
  await sb.from('incoming_missions').update({ status: 'ignored', updated_at: new Date().toISOString() }).eq('id', seul.id)
  await sb.from('mission_logs').insert({
    mission_id: seul.id, action: 'vab_vr_fusionne',
    notes: `VAB : livraison du véhicule de remplacement reprise dans la mission remorquage #${rem?.mission_number ?? '?'} (même dossier ${dossierBase}) — cette fiche est écartée.`,
    metadata: { into: remFiche.id, dossier: dossierBase, auto: true },
  }).then(() => {}, () => {})
  return true
}

// src/lib/missions/rel-police.ts — commande d'assistance pour un véhicule au parc sur APPEL POLICE (Olivier 16/11/2026,
// 1FEO036, maquette https://claude.ai/artifact/L3vU8S8RcApgXaXDBUswf5 validée).
//
// Une assistance (Touring, VAB, AXA, Allianz, IMA…) commande un remorquage pour une voiture que nous gardons après un
// appel police. On ne rattache plus tout seul : le dispatch reçoit une fenêtre et choisit
//   - rel_pec : la relivraison, et l'assistance prend aussi en charge l'appel police → rattachée, la fiche police et son
//               gardiennage passent au nom de l'assistance ;
//   - rel     : la relivraison seulement → rattachée, la fiche police garde son payeur ;
//   - isolee  : une mission à part → rien n'est rattaché.
// Le premier qui répond décide (fenêtre fermée chez les autres). Le ✕ = « je décide plus tard » : la fenêtre se ferme chez
// lui, la mission garde l'alerte « Véhicule au parc · à trancher » dans le dispatch.
// Rattachement : commande pas encore donnée à un chauffeur → mise en réserve habituelle (« À relivrer ») ; déjà donnée →
// elle devient la relivraison active et le chauffeur la garde. Le lien d'assistance fait foi : la clôture part par elle.

import type { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { nightsBetween } from '@/lib/parc/nights'
import { listSourceCatalog } from '@/lib/missions/source-catalog'

type Sb = ReturnType<typeof createAdminClient>
export type ChoixRelPolice = 'rel_pec' | 'rel' | 'isolee'
export const NOTIF_REL_POLICE = 'rel_police_a_trancher'
const FINIS = ['completed', 'to_invoice', 'invoiced', 'cancelled', 'deleted', 'ignored']

export interface RelPolice {
  parent_id: string; parent_number: number | null; request_group: string; detected_at: string
  decision?: ChoixRelPolice; decided_at?: string; decided_by?: string; decided_by_name?: string | null
  payeur_avant?: { id: number | null; name: string | null } | null
}
export const relPoliceEnAttente = (rp: any): boolean => !!rp?.parent_id && !rp?.decided_at

async function libelleSource(source?: string | null): Promise<string> {
  try { const r = (await listSourceCatalog()).find(x => x.key === source); if (r?.label) return r.label } catch { /* catalogue illisible */ }
  return String(source || 'Assistance')
}
const norm = (s?: string | null) => String(s || '').toLowerCase()

/** Pose la question au dispatch (sans rien rattacher). Appelé par la mise en réserve (lib/missions/reserve-rel.ts). */
export async function signalerRelPolice(sb: Sb, relId: string, parentId: string): Promise<void> {
  const [{ data: m }, { data: p }] = await Promise.all([
    sb.from('incoming_missions').select('id, mission_number, source, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, incident_type, incident_address, destination_name, destination_address, rel_police').eq('id', relId).maybeSingle(),
    sb.from('incoming_missions').select('id, mission_number, source, dossier_number, incident_type, incident_address, parked_at, created_at, parc_zone_key, billed_to_name, invoice_odoo_id').eq('id', parentId).maybeSingle(),
  ])
  if (!m || !p) return
  if (relPoliceEnAttente((m as any).rel_police)) return   // déjà demandée
  const now = new Date().toISOString()
  const group = `rp-${relId}-${Date.now()}`
  const rp: RelPolice = { parent_id: p.id, parent_number: (p as any).mission_number ?? null, request_group: group, detected_at: now }
  await sb.from('incoming_missions').update({ rel_police: rp, updated_at: now }).eq('id', relId)

  const src = await libelleSource(m.source)
  const srcPolice = await libelleSource(p.source)
  const depot = /lefin|cit[ée] 22|pepinster/i.test(String(m.incident_address || ''))
  const concordances = ['même plaque', depot ? 'départ de notre dépôt' : null,
    /accident/.test(norm(m.incident_type)) && /accident/.test(norm(p.source) + norm(p.incident_type)) ? 'même motif (accident)' : null].filter(Boolean)
  const plate = m.vehicle_plate || 'sans plaque'
  const nuits = nightsBetween((p as any).parked_at || p.created_at)

  await sb.from('mission_logs').insert([
    { mission_id: m.id, action: 'rel_police_asked', notes: `Véhicule au parc sur la fiche police #${p.mission_number ?? ''} (${srcPolice}) : rattachement à trancher par le dispatch (relivraison avec ou sans prise en charge de l'appel police, ou mission à part).`, metadata: { parent_mission_id: p.id, request_group: group } },
    { mission_id: p.id, action: 'rel_police_asked', notes: `${src} a commandé une mission pour ce véhicule (#${m.mission_number ?? ''}, ${m.external_id || m.dossier_number || ''}) : rattachement à trancher par le dispatch.`, metadata: { rel_id: m.id, request_group: group } },
  ]).then(() => {}, () => {})

  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], NOTIF_REL_POLICE, {
    title: `🅿️ ${plate} est déjà au parc après un appel police`,
    body: `${src} a envoyé une mission pour ce véhicule. Relivraison (avec ou sans prise en charge de l'appel police) ou mission à part ?`,
    mission_id: m.id, action_url: '/dispatch',
    data: {
      modal: true, kind: 'rel_police', request_group: group, mission_id: m.id, mission_number: m.mission_number, plate,
      vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
      source: src, ref: m.dossier_number || m.external_id || null, rel_depart: m.incident_address || null,
      rel_destination: [m.destination_name, m.destination_address].filter(Boolean).join(', ') || null, rel_motif: m.incident_type || null,
      parent_id: p.id, parent_number: p.mission_number, parent_dossier: p.dossier_number || null, parent_source: srcPolice,
      parent_lieu: p.incident_address || null, parent_entree: (p as any).parked_at || p.created_at, parent_nuits: nuits,
      parent_zone: (p as any).parc_zone_key || null, parent_facture: !!(p as any).invoice_odoo_id, concordances,
    },
  }).catch(() => {})
}

/** Ferme la fenêtre chez tous les destinataires de la même demande. */
async function fermerGroupe(sb: Sb, group: string | null | undefined) {
  if (!group) return
  const now = new Date().toISOString()
  await sb.from('notifications_log').update({ responded_at: now, read_at: now })
    .eq('notif_type', NOTIF_REL_POLICE).is('responded_at', null).eq('payload->data->>request_group', group)
}

/** « Je décide plus tard » : la fenêtre se ferme chez cette personne seulement ; l'alerte reste dans le dispatch. */
export async function plusTardRelPolice(sb: Sb, notifId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString()
  const { error } = await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('id', notifId).eq('user_id', userId).eq('notif_type', NOTIF_REL_POLICE)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Décision du dispatch. Le premier qui répond décide. */
export async function deciderRelPolice(sb: Sb, relId: string, user: { id: string; name?: string | null }, choix: ChoixRelPolice): Promise<{ ok: boolean; error?: string; already?: boolean; note?: string }> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, status, source, external_id, dossier_number, vehicle_plate, assigned_to, loaded_at, parent_mission_id, dossier_leg, billed_to_id, billed_to_name, destination_address, destination_name, destination_lat, destination_lng, rel_police')
    .eq('id', relId).maybeSingle()
  if (!m) return { ok: false, error: 'Mission introuvable' }
  const rp = (m as any).rel_police as RelPolice | null
  if (!rp || !relPoliceEnAttente(rp)) { await fermerGroupe(sb, (rp as any)?.request_group); return { ok: true, already: true } }
  const now = new Date().toISOString()
  const qui = user.name || '—'
  const src = await libelleSource(m.source)

  if (choix === 'isolee') {
    await sb.from('incoming_missions').update({ rel_police: { ...rp, decision: choix, decided_at: now, decided_by: user.id, decided_by_name: user.name || null }, updated_at: now }).eq('id', m.id)
    await sb.from('mission_logs').insert([
      { mission_id: m.id, actor_id: user.id, action: 'rel_police_isolee', notes: `Dispatch (${qui}) : mission à part, pas de lien avec la fiche police #${rp.parent_number ?? ''}.` },
      { mission_id: rp.parent_id, actor_id: user.id, action: 'rel_police_isolee', notes: `Dispatch (${qui}) : la mission ${src} #${m.mission_number ?? ''} est une mission à part, rien n'est rattaché.` },
    ]).then(() => {}, () => {})
    await fermerGroupe(sb, rp.request_group)
    return { ok: true, note: 'Mission à part : rien n’est rattaché.' }
  }

  // Rattachement : le véhicule doit toujours être au parc sur la fiche police.
  const { data: p } = await sb.from('incoming_missions').select('id, mission_number, status, depot_depart_id, redelivery_address, billed_to_id, billed_to_name').eq('id', rp.parent_id).maybeSingle()
  if (!p || p.status !== 'parked') return { ok: false, error: 'Le véhicule n’est plus au parc sur la fiche police : à traiter à la main.' }
  if ((m as any).dossier_leg || (m.parent_mission_id && m.parent_mission_id !== p.id)) return { ok: false, error: 'Cette mission fait déjà partie d’un autre dossier.' }
  if (FINIS.includes(String(m.status)) || m.loaded_at) return { ok: false, error: `La mission est déjà ${m.status}${m.loaded_at ? ' (chargée)' : ''} : on ne la rattache plus.` }

  let mode: 'reserve' | 'active'
  if (!m.assigned_to && ['new', 'dispatching'].includes(String(m.status))) {
    const { reserveTowForParkedVehicle } = await import('./reserve-rel')
    const r = await reserveTowForParkedVehicle({ sb, missionId: m.id, actorId: user.id, actorName: `dispatch (${qui})`, parentId: p.id })
    if (!r.reserved) return { ok: false, error: `Rattachement refusé : ${r.reason}.` }
    mode = 'reserve'
  } else {
    // Déjà donnée à un chauffeur : elle devient la relivraison active du dossier, le chauffeur la garde.
    const { appliquerRelivraisonAuParent } = await import('./reserve-rel')
    await appliquerRelivraisonAuParent(sb, p, m, user.id, `dispatch (${qui})`, false)
    const { error } = await sb.from('incoming_missions').update({ parent_mission_id: p.id, mission_type: 'REL', incident_type: 'relivraison', updated_at: now }).eq('id', m.id)
    if (error) return { ok: false, error: error.message }
    mode = 'active'
  }

  // Prise en charge de l'appel police : la fiche police et son gardiennage passent au nom de l'assistance (pas ce qui est
  // déjà facturé).
  let payeurAvant: RelPolice['payeur_avant'] = null
  if (choix === 'rel_pec' && m.billed_to_id) {
    payeurAvant = { id: (p as any).billed_to_id ?? null, name: (p as any).billed_to_name ?? null }
    const { data: legs } = await sb.from('incoming_missions').select('id, status, invoice_odoo_id').or(`id.eq.${p.id},and(parent_mission_id.eq.${p.id},dossier_leg.eq.true)`)
    const ids = (legs || []).filter((l: any) => !l.invoice_odoo_id && !['invoiced', 'cancelled', 'deleted'].includes(String(l.status))).map((l: any) => l.id)
    if (ids.length) await sb.from('incoming_missions').update({ billed_to_id: m.billed_to_id, billed_to_name: m.billed_to_name, updated_at: now }).in('id', ids)
  }

  await sb.from('incoming_missions').update({ rel_police: { ...rp, decision: choix, decided_at: now, decided_by: user.id, decided_by_name: user.name || null, payeur_avant: payeurAvant }, updated_at: now }).eq('id', m.id)
  const pec = choix === 'rel_pec'
  await sb.from('mission_logs').insert([
    { mission_id: m.id, actor_id: user.id, action: 'rel_attached', notes: `Dispatch (${qui}) : relivraison de la fiche police #${p.mission_number ?? ''}${pec ? `, ${src} prend aussi en charge l'appel police` : ' seulement'}. Lien ${src} gardé, clôture par cette fiche${mode === 'active' ? ' ; le chauffeur garde la mission' : ' ; en réserve dans « À relivrer »'}.`, metadata: { parent_mission_id: p.id, choix } },
    { mission_id: p.id, actor_id: user.id, action: 'rel_attached', notes: `Dispatch (${qui}) : la mission ${src} #${m.mission_number ?? ''} est la relivraison de ce dossier.${pec ? ` ${src} prend en charge l'appel police : payeur ${payeurAvant?.name || '—'} → ${m.billed_to_name || src} (fiche et gardiennage).` : ' L’appel police garde son payeur.'}`, metadata: { rel_id: m.id, choix, payeur_avant: payeurAvant } },
  ]).then(() => {}, () => {})
  await fermerGroupe(sb, rp.request_group)
  return { ok: true, note: `Rattachée à la fiche police #${p.mission_number ?? ''}${mode === 'active' ? ', le chauffeur garde la mission' : ', en réserve dans « À relivrer »'}${pec ? ` ; appel police au nom de ${m.billed_to_name || src}` : ''}.` }
}

/** Décision depuis la fenêtre (notification). */
export async function deciderRelPoliceParNotif(sb: Sb, notifId: string, userId: string, choix: ChoixRelPolice | 'plus_tard') {
  const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', notifId).eq('user_id', userId).maybeSingle()
  const d = (n as any)?.payload?.data || {}
  if (!n || (n as any).notif_type !== NOTIF_REL_POLICE || !d.mission_id) return { ok: false, error: 'Notification inconnue' }
  if (choix === 'plus_tard') return plusTardRelPolice(sb, notifId, userId)
  const { data: me } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  return deciderRelPolice(sb, d.mission_id, { id: userId, name: (me as any)?.name || null }, choix)
}

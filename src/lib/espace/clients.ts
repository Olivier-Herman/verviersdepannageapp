// src/lib/espace/clients.ts
//
// VD Assistance — les clients des garages partenaires (Olivier 10/10/2026, prototype validé puis complété) :
//   - Un client = une personne (compte unique par adresse mail), avec PLUSIEURS véhicules. Chaque véhicule est relié
//     à un garage partenaire, choisi parmi les sites de ce garage (pas d'adresse libre) : en cas de remorquage, le
//     véhicule va à ce garage et nulle part ailleurs. Le client ne change jamais le garage d'un véhicule ; seul le
//     dispatch peut le réaffecter.
//   - Option du garage : activée par son gestionnaire (espace_societes.clients_actif).
//   - Le garage classe chaque VÉHICULE : assistance (facturé au garage, source du garage, comme aujourd'hui) ou pas
//     (source « <garage> clients » = grille du garage + 20 %, facture au nom du client, tout encaissé par le chauffeur,
//     pas d'acompte).
//   - La demande part en dépannage sur place ; le chauffeur la transforme en remorquage si besoin.
//   - Déplacement pour rien : forfait de la grille (75 € TVAC), non commissionné.
//   - Commission du garage : un pourcentage (réglage métier) du prix payé, reversé par une note de crédit par mois.
//   - Notifications au client en panne s'il les accepte (client-notif.ts) ; aucune au garage.

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { isTrajetVide } from '@/lib/missions/mission-types'
import type { EspaceSociete } from './session'

export interface SocieteClients extends EspaceSociete {
  clients_actif: boolean; clients_slug: string | null; clients_source_key: string | null
  demo?: boolean
}
export interface EspaceClient {
  id: string; prenom: string; nom: string; tel: string; email: string; adresse: string; verifie_le: string | null
  odoo_partner_id: number | null; session_version: number; active: boolean; created_at: string
}
export interface GarageSite { id: string; nom: string; adresse: string; lat: number | null; lng: number | null }
export interface EspaceVehicule {
  id: string; client_id: string; plaque: string; marque: string | null; modele: string | null; assistance: boolean
  created_at: string; garage: GarageSite; societe: SocieteClients
}

const TVA = 1.21
const r2 = (n: number) => Math.round(n * 100) / 100
export const SOC_COLS = 'id, nom, odoo_partner_id, source_key, appel_audio, couleur, clients_actif, clients_slug, clients_source_key, demo'
export const normPlaque = (v: unknown) => String(v || '').replace(/[\s.-]/g, '').toUpperCase().slice(0, 15)

export async function societeParSlug(slug: string): Promise<SocieteClients | null> {
  const s = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!s) return null
  const { data } = await createAdminClient().from('espace_societes').select(SOC_COLS).eq('clients_slug', s).eq('active', true).maybeSingle()
  return (data as SocieteClients) || null
}

/** Garages partenaires qui ont activé le service, avec leurs sites (le garage de démonstration seulement sur demande). */
export async function garagesPartenaires(opts?: { slug?: string | null }): Promise<(SocieteClients & { sites: GarageSite[] })[]> {
  const sb = createAdminClient()
  let q = sb.from('espace_societes').select(SOC_COLS).eq('active', true).eq('clients_actif', true).not('clients_slug', 'is', null)
  q = opts?.slug ? q.eq('clients_slug', opts.slug) : q.eq('demo', false)
  const { data: socs } = await q.order('nom')
  if (!socs?.length) return []
  const { data: sites } = await sb.from('espace_garages').select('id, societe_id, nom, adresse, lat, lng').in('societe_id', socs.map(s => s.id)).order('ordre')
  return (socs as SocieteClients[]).map(s => ({ ...s, sites: (sites || []).filter(g => g.societe_id === s.id).map(({ societe_id, ...g }) => g) }))
}

// ── Session du client : un cookie signé, pour tous ses véhicules ──
const DUREE_S = 365 * 24 * 3600
export const CLIENT_COOKIE = 'vd_client'
const mac = (p: string) => crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || '').update(`client:${p}`).digest('base64url')
export function signClient(c: Pick<EspaceClient, 'id' | 'session_version'>): string {
  const p = Buffer.from(JSON.stringify({ c: c.id, v: c.session_version })).toString('base64url')
  return `${p}.${mac(p)}`
}
export const clientCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: DUREE_S }

export async function getClientSession(): Promise<{ client: EspaceClient } | null> {
  if (!process.env.NEXTAUTH_SECRET) return null
  const [p, sig] = String(cookies().get(CLIENT_COOKIE)?.value || '').split('.')
  if (!p || !sig) return null
  const want = mac(p)
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  let o: any
  try { o = JSON.parse(Buffer.from(p, 'base64url').toString()) } catch { return null }
  const { data: client } = await createAdminClient().from('espace_clients').select('*').eq('id', String(o?.c || '')).maybeSingle()
  if (!client || !client.active || !client.verifie_le || Number(client.session_version) !== Number(o?.v)) return null
  return { client: client as EspaceClient }
}

export async function vehiculesDuClient(clientId: string): Promise<EspaceVehicule[]> {
  const sb = createAdminClient()
  const { data: v } = await sb.from('espace_vehicules').select('id, client_id, plaque, marque, modele, assistance, created_at, garage_id, societe_id')
    .eq('client_id', clientId).eq('active', true).order('created_at')
  if (!v?.length) return []
  const [{ data: socs }, { data: gars }] = await Promise.all([
    sb.from('espace_societes').select(SOC_COLS).in('id', Array.from(new Set(v.map(x => x.societe_id)))),
    sb.from('espace_garages').select('id, nom, adresse, lat, lng').in('id', Array.from(new Set(v.map(x => x.garage_id)))),
  ])
  return v.flatMap(x => {
    const societe = (socs || []).find(s => s.id === x.societe_id) as SocieteClients | undefined
    const garage = (gars || []).find(g => g.id === x.garage_id) as GarageSite | undefined
    if (!societe || !garage) return []
    const { garage_id, societe_id, ...rest } = x
    return [{ ...rest, garage, societe }]
  })
}

export async function vehiculeDuClient(clientId: string, vehiculeId: string): Promise<EspaceVehicule | null> {
  return (await vehiculesDuClient(clientId)).find(v => v.id === vehiculeId) || null
}

/** Un véhicule à inscrire : le site doit appartenir à un garage partenaire actif (pas d'adresse libre). */
export async function lireVehicule(b: any): Promise<{ plaque: string; marque: string; modele: string; garage: GarageSite & { societe_id: string }; societe: SocieteClients } | string> {
  const plaque = normPlaque(b?.plaque)
  const marque = String(b?.marque || '').trim().slice(0, 40), modele = String(b?.modele || '').trim().slice(0, 60)
  if (!plaque || !marque || !modele) return 'La plaque, la marque et le modèle sont obligatoires.'
  const sb = createAdminClient()
  const { data: g } = await sb.from('espace_garages').select('id, societe_id, nom, adresse, lat, lng').eq('id', String(b?.garageId || '')).maybeSingle()
  if (!g) return 'Choisissez le garage de ce véhicule.'
  const { data: s } = await sb.from('espace_societes').select(SOC_COLS).eq('id', g.societe_id).eq('active', true).maybeSingle()
  if (!s?.clients_actif) return 'Ce garage n’a pas activé le service.'
  return { plaque, marque, modele, garage: g as any, societe: s as SocieteClients }
}

/** Le garage est averti à chaque véhicule inscrit chez lui, pour vérifier le client et cocher son assistance. */
export async function avertirGarage(societe: SocieteClients, client: EspaceClient, v: { plaque: string; marque: string | null; modele: string | null }, site: string) {
  if (societe.demo) return
  const sb = createAdminClient()
  const { data: comptes } = await sb.from('espace_comptes').select('emails, role').contains('societe_ids', [societe.id]).eq('active', true).in('role', ['societe', 'gestionnaire'])
  const to = Array.from(new Set((comptes || []).map((x: any) => x.emails?.[0]).filter(Boolean))) as string[]
  const { avertirGarageNouveauClient } = await import('./mails')
  await avertirGarageNouveauClient(to, societe.nom, { ...client, ...v, garage: site })
}

// ── Estimations affichées avant de commander (TVAC) : dépannage sur place, et remorquage jusqu'au garage du
// véhicule, par la route réelle (Olivier 10/10/2026). ──
export async function estimations(v: EspaceVehicule, lat: number, lng: number): Promise<{ dsp: number | null; rem: number | null; garage: string | null }> {
  const vide = { dsp: null, rem: null, garage: null }
  const source = v.societe.clients_source_key
  if (!source || !Number.isFinite(lat) || !Number.isFinite(lng)) return vide
  const { withRoutingMode } = await import('@/lib/routing/mode')
  const { depotLoopKm, depotRemKm, estimateMissionPrice } = await import('@/lib/missions/estimate-price')
  const now = new Date().toISOString()
  const prix = async (mission_type: string, total_km: number, charged_km: number) => {
    const e = await estimateMissionPrice({ source, mission_type, client_name: null, vehicle_mileage: null, total_km, charged_km, intervention_date: now, received_at: now } as any)
    return e.ok && e.total_eur > 0 ? r2(e.total_eur * TVA) : null
  }
  return withRoutingMode('free', async () => {
    const km = await depotLoopKm({ lat, lng })
    const dsp = km == null ? null : await prix('depannage', km, 0)
    let rem: number | null = null
    if (v.garage.lat != null && v.garage.lng != null) {
      const r = await depotRemKm({ lat, lng }, { lat: Number(v.garage.lat), lng: Number(v.garage.lng) })
      rem = r ? await prix('remorquage', r.totalKm, r.chargedKm) : null
    }
    return { dsp, rem, garage: v.garage.nom }
  })
}

/** Sources dont le chauffeur encaisse tout (tag du catalogue). */
export async function sourcesEncaissementChauffeur(): Promise<Set<string>> {
  const { data } = await createAdminClient().from('mission_source_catalog').select('key').contains('tags', ['encaissement_chauffeur'])
  return new Set((data || []).map((x: any) => x.key))
}

/**
 * Montant TVAC à encaisser par le chauffeur pour une commande d'un client sans assistance. Recalculé quand la
 * mission change (dépannage transformé en remorquage, adresse corrigée, déplacement pour rien). Jamais après un
 * encaissement, ni sur un montant fixé à la main.
 */
export async function recalcMontantClient(missionId: string): Promise<number | null> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('*').eq('id', missionId).maybeSingle()
  if (!m?.espace_client_id || m.amount_to_collect_manual === true || m.payment_collected_at || Number(m.payment_amount) > 0) return null
  if (!(await sourcesEncaissementChauffeur()).has(String(m.source || ''))) return null
  let tvac: number | null = null
  if (isTrajetVide(m.mission_type)) {
    // Forfait : ni km ni majoration horaire.
    const { data: t } = await sb.from('source_tariffs').select('unit_price').eq('source', m.source).eq('mission_type', 'trajet_vide').is('effective_to', null).maybeSingle()
    tvac = t?.unit_price ? r2(Number(t.unit_price) * TVA) : null
  } else {
    const { withRoutingMode } = await import('@/lib/routing/mode')
    const { estimateMissionPrice } = await import('@/lib/missions/estimate-price')
    const e = await withRoutingMode('free', () => estimateMissionPrice({ ...m, amount_to_collect: null }))
    tvac = e.ok && e.total_eur > 0 ? r2(e.total_eur * TVA) : null
  }
  if (tvac != null && tvac !== Number(m.amount_to_collect)) {
    await sb.from('incoming_missions').update({ amount_to_collect: tvac, updated_at: new Date().toISOString() }).eq('id', missionId)
  }
  return tvac
}

/** Partenaire de facturation du client (créé à sa première commande à sa charge). */
async function partenaireClient(c: EspaceClient): Promise<number | null> {
  if (c.odoo_partner_id) return c.odoo_partner_id
  try {
    const { findOrCreatePartner } = await import('@/lib/odoo')
    const m = c.adresse.match(/^(.*?),?\s*(\d{4})\s+([^,]+)(?:,.*)?$/)
    const id = await findOrCreatePartner({
      name: `${c.prenom} ${c.nom}`.trim(), phone: c.tel, email: c.email,
      street: m ? m[1].replace(/,\s*$/, '').trim() : c.adresse, zip: m?.[2], city: m?.[3]?.trim(),
    })
    await createAdminClient().from('espace_clients').update({ odoo_partner_id: id }).eq('id', c.id)
    return id
  } catch (e: any) {
    console.error('[VD Assistance] partenaire KO', e?.message)
    return null
  }
}

export const PANNES = ['Ne démarre pas', 'Batterie', 'Crevaison', 'Accident', 'Bruit / fumée', 'Clés enfermées', 'Autre'] as const

export interface CommandeInput { vehiculeId: string; adresse: string; lat: number; lng: number; panne: string; symptome?: string | null }

export function lireCommande(b: any): CommandeInput | string {
  const vehiculeId = String(b?.vehiculeId || '')
  if (!vehiculeId) return 'Choisissez le véhicule en panne.'
  const adresse = String(b?.adresse || '').trim().slice(0, 300)
  const lat = Number(b?.lat), lng = Number(b?.lng)
  if (!adresse || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'Indiquez où vous êtes.'
  const panne = String(b?.panne || '')
  if (!(PANNES as readonly string[]).includes(panne)) return 'Dites-nous ce qui se passe.'
  const symptome = String(b?.symptome || '').trim().slice(0, 300) || null
  if (panne === 'Autre' && !symptome) return 'Décrivez les symptômes en une ligne.'
  return { vehiculeId, adresse, lat, lng, panne, symptome }
}

export async function creerCommande(client: EspaceClient, v: EspaceVehicule, d: CommandeInput): Promise<{ id: string; mission_number: number }> {
  const sb = createAdminClient()
  const societe = v.societe
  const now = new Date().toISOString()
  const nom = `${client.prenom} ${client.nom}`.trim()
  const assistance = v.assistance
  const demo = !!societe.demo
  const source = demo ? 'demo_assistance' : assistance ? societe.source_key : societe.clients_source_key!
  // Garage de démonstration (validation Apple) : rien dans l'ERP, rien au dispatch.
  const partner = demo ? null : assistance ? societe.odoo_partner_id : await partenaireClient(client)
  const panne = d.panne === 'Autre' ? `Autre : ${d.symptome}` : d.symptome ? `${d.panne} — ${d.symptome}` : d.panne
  const remarques = [
    `Client du garage ${societe.nom} — commande passée par le client lui-même (VD Assistance).`,
    `Garage du véhicule : ${v.garage.nom}, ${v.garage.adresse}. En cas de remorquage, livrer UNIQUEMENT à ce garage.`,
    assistance ? `Assistance ${societe.nom} : facturé à ${societe.nom}.` : `Pas d’assistance : le client paie tout au chauffeur (tarif ${societe.nom} + 20 %). Facture au nom du client.`,
    `Panne signalée : ${panne}`,
    `Client : ${nom} — ${client.tel} — ${client.email}`,
    `Adresse du client : ${client.adresse}`,
  ].join('\n')
  const { data: gp } = await sb.from('garage_partners').select('id').eq('odoo_partner_id', societe.odoo_partner_id).eq('active', true).limit(1)
  const { data: m, error } = await sb.from('incoming_missions').insert({
    external_id: `CLI-${Date.now().toString(36).toUpperCase()}`,
    source, mission_type: 'depannage', status: demo ? 'ignored' : 'new',
    vehicle_plate: v.plaque, vehicle_brand: v.marque, vehicle_model: v.modele,
    incident_address: d.adresse, incident_lat: d.lat, incident_lng: d.lng,
    destination_address: v.garage.adresse, destination_name: v.garage.nom,
    destination_lat: v.garage.lat ?? null, destination_lng: v.garage.lng ?? null,
    client_name: nom, client_phone: client.tel,
    assisted_name: nom, assisted_phone: client.tel,
    incident_description: panne,
    requested_by_garage_id: gp?.[0]?.id || null,
    billed_to_id: partner, billed_to_name: assistance ? societe.nom : nom,
    amount_to_collect: null,
    remarks_general: remarques,
    espace_client_id: client.id, espace_vehicule_id: v.id,
    received_at: now, intervention_date: now, incident_at: now,
    created_at: now, updated_at: now,
  }).select('id, mission_number').single()
  if (error || !m) throw new Error(error?.message || 'Création impossible')
  await sb.from('mission_logs').insert({ mission_id: m.id, action: 'received', notes: `Commande passée par ${nom} (VD Assistance), véhicule du garage ${societe.nom} (${assistance ? 'assistance du garage' : 'paiement au chauffeur'}).` }).then(() => {}, () => {})
  if (demo) return m as any
  if (!assistance) await recalcMontantClient(m.id).catch(() => null)

  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'espace_client_demande', {
    title: `🔧 Dépannage — client ${societe.nom}`,
    body: `${[v.marque, v.modele, v.plaque].filter(Boolean).join(' ')} · ${d.adresse} · ${assistance ? `assistance ${societe.nom}` : 'paiement au chauffeur'} — à valider dans les commandes`,
    action_url: `/dispatch/${m.id}`, mission_id: m.id,
  }).catch(() => {})
  const { appelerDepannage } = await import('./demande')
  await appelerDepannage(m.id, societe).catch(() => {})
  return m as any
}

/** Commande en cours du client (ou la dernière des 24 dernières heures), avec ses étapes. */
export async function commandeDuClient(client: EspaceClient) {
  const sb = createAdminClient()
  const { MISSION_COLS, suiviClient, relivraisonsDe } = await import('./missions')
  const { data } = await sb.from('incoming_missions').select(`${MISSION_COLS}, amount_to_collect, payment_collected_at, payment_amount, espace_vehicule_id, client_paiement`)
    .eq('espace_client_id', client.id).is('parent_mission_id', null).order('created_at', { ascending: false }).limit(1)
  const m: any = data?.[0]
  if (!m) return null
  const fini = ['completed', 'to_invoice', 'invoiced', 'cancelled'].includes(m.status)
  const ref = m.completed_at || m.cancelled_at || m.updated_at || m.created_at
  if (fini && Date.now() - new Date(ref).getTime() > 24 * 3600_000) return null
  const rel = (await relivraisonsDe([m.id])).get(m.id) || null
  const { data: dem } = await sb.from('garage_cancellation_requests').select('id').eq('mission_id', m.id).eq('status', 'pending').limit(1)
  const aSaCharge = (await sourcesEncaissementChauffeur()).has(String(m.source || ''))
  return {
    id: m.id as string, numero: m.mission_number as number, adresse: m.incident_address as string | null,
    panne: m.incident_description as string | null,
    vehicule: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '), plaque: m.vehicle_plate as string | null,
    suivi: suiviClient(m, rel),
    aPayer: aSaCharge && m.amount_to_collect ? Number(m.amount_to_collect) : null,
    aSaCharge,
    deplacementPourRien: isTrajetVide(m.mission_type),
    annulable: !fini && !dem?.length,
    annulationEnCours: !!dem?.length,
    parti: !!(m.on_way_at || m.on_site_at || m.loaded_at),
    // Paiement demandé par le chauffeur dans l'app (SumUp) : le client voit « Payer » jusqu'à la confirmation.
    paiement: m.client_paiement?.url ? {
      montant: Number(m.client_paiement.montant || 0),
      url: String(m.client_paiement.url),
      paye: !!m.client_paiement.enregistre_le || (!!m.payment_collected_at && Number(m.payment_amount || 0) + 0.01 >= Number(m.client_paiement.montant || 0)),
    } : null,
  }
}

/** Annulation par le client : avant validation, tout de suite ; ensuite, le dispatch tranche (sans frais avant départ, déplacement facturé après). */
export async function annulerCommande(client: EspaceClient, missionId: string): Promise<{ ok: boolean; message: string }> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, status, source, vehicle_plate, on_way_at, on_site_at, loaded_at, requested_by_garage_id, espace_vehicule_id')
    .eq('id', missionId).eq('espace_client_id', client.id).maybeSingle()
  if (!m) return { ok: false, message: 'Demande introuvable.' }
  if (['completed', 'to_invoice', 'invoiced', 'cancelled'].includes(m.status)) return { ok: false, message: 'Cette intervention est déjà terminée ou annulée.' }
  const v = m.espace_vehicule_id ? await vehiculeDuClient(client.id, m.espace_vehicule_id) : null
  const garageNom = v?.societe.nom || 'partenaire'
  const now = new Date().toISOString()
  const nom = `${client.prenom} ${client.nom}`
  if (m.source === 'demo_assistance') {
    await sb.from('incoming_missions').update({ status: 'cancelled', cancelled_at: now, cancelled_reason: 'Démonstration', updated_at: now }).eq('id', m.id)
    return { ok: true, message: 'Demande annulée, sans frais.' }
  }
  if (m.status === 'new') {
    await sb.from('incoming_missions').update({ status: 'cancelled', cancelled_at: now, cancelled_reason: `Annulée par le client (${nom}) avant validation`, updated_at: now }).eq('id', m.id).eq('status', 'new')
    await sb.from('mission_logs').insert({ mission_id: m.id, action: 'cancelled', notes: `Annulée par ${nom}, client du garage ${garageNom}, avant validation.` }).then(() => {}, () => {})
    const { majActiviteClient } = await import('./client-notif')
    await majActiviteClient(m.id, 'annulee')
    await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'espace_client_demande', {
      title: '✕ Demande annulée par le client', body: `#${m.mission_number} ${m.vehicle_plate || ''} — client ${garageNom}, annulée avant validation.`, action_url: `/dispatch/${m.id}`, mission_id: m.id,
    }).catch(() => {})
    return { ok: true, message: 'Demande annulée, sans frais.' }
  }
  const { data: existe } = await sb.from('garage_cancellation_requests').select('id').eq('mission_id', m.id).eq('status', 'pending').maybeSingle()
  if (existe) return { ok: true, message: 'Votre annulation est déjà en cours.' }
  const parti = !!(m.on_way_at || m.on_site_at || m.loaded_at)
  const frais = parti && (await sourcesEncaissementChauffeur()).has(String(m.source || ''))
  const { error } = await sb.from('garage_cancellation_requests').insert({
    mission_id: m.id, requested_by_garage_id: m.requested_by_garage_id, requested_by_user_id: null, status: 'pending',
    reason: `Annulation demandée par le client ${nom} (garage ${garageNom}) — ${parti ? (frais ? 'dépanneur déjà parti : déplacement pour rien à facturer au client' : 'dépanneur déjà parti (assistance du garage)') : 'dépanneur pas encore parti : sans frais'}`,
  })
  if (error) return { ok: false, message: 'L’annulation n’a pas pu être enregistrée. Appelez-nous.' }
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'garage_cancel_request', {
    title: '🛑 Annulation demandée par un client', body: `#${m.mission_number}${m.vehicle_plate ? ' · ' + m.vehicle_plate : ''} — client ${garageNom}${parti ? ', dépanneur déjà parti' : ''}. À décider.`, action_url: '/admin/garage-cancellations', mission_id: m.id,
  }).catch(() => {})
  return { ok: true, message: frais ? 'Annulation transmise. Le dépanneur était déjà en route : le déplacement vous sera facturé.' : 'Annulation transmise, sans frais.' }
}

/**
 * Commission du garage pour un mois (AAAA-MM) : un pourcentage du prix HTVA payé par ses clients sans assistance,
 * déplacements pour rien exclus. Sert à l'affichage dans l'espace du garage et à la note de crédit mensuelle.
 */
export async function commissionDuMois(societe: SocieteClients, mois: string): Promise<{ htva: number; base: number; nb: number; pct: number }> {
  const { getBusinessNumber } = await import('@/lib/settings/business')
  const pct = await getBusinessNumber('espace_clients_commission_pct').catch(() => 0)
  if (!societe.clients_source_key || !pct) return { htva: 0, base: 0, nb: 0, pct }
  const debut = new Date(`${mois}-01T00:00:00Z`)
  const fin = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + 1, 1))
  const { data } = await createAdminClient().from('incoming_missions').select('mission_type, amount_to_collect, payment_amount, status')
    .eq('source', societe.clients_source_key).not('espace_client_id', 'is', null)
    .in('status', ['completed', 'to_invoice', 'invoiced'])
    .gte('completed_at', debut.toISOString()).lt('completed_at', fin.toISOString())
  let base = 0, nb = 0
  for (const m of data || []) {
    if (isTrajetVide(m.mission_type)) continue
    const tvac = Number(m.payment_amount) > 0 ? Number(m.payment_amount) : Number(m.amount_to_collect || 0)
    if (tvac <= 0) continue
    base += tvac / TVA; nb++
  }
  return { htva: r2(base * pct / 100), base: r2(base), nb, pct }
}

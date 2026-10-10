// src/lib/espace/clients.ts
//
// Clients des garages (Olivier 10/10/2026, prototype validé) : le client d'un garage partenaire (EBAC, Centracar…)
// s'inscrit par le QR code du garage et commande lui-même son dépannage.
//   - Option du garage : activée par son gestionnaire (espace_societes.clients_actif).
//   - Le garage classe chaque client. Avec assistance : facturé au garage, source du garage, comme aujourd'hui.
//     Sans assistance (ou pas encore classé) : source « <garage> clients » (grille du garage + 20 %), facture au nom
//     du client, tout est encaissé par le chauffeur. Pas d'acompte.
//   - La demande part en dépannage sur place ; le chauffeur la transforme en remorquage si besoin.
//   - Déplacement pour rien : forfait de la grille (75 € TVAC), non commissionné.
//   - Commission du garage : un pourcentage (réglage métier) du prix payé, reversé par une note de crédit par mois.
//   - Aucune notification au client, à part le code par mail.

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { isTrajetVide } from '@/lib/missions/mission-types'
import type { EspaceSociete } from './session'

export interface SocieteClients extends EspaceSociete {
  clients_actif: boolean; clients_slug: string | null; clients_source_key: string | null
}
export interface EspaceClient {
  id: string; societe_id: string; prenom: string; nom: string; tel: string; email: string; adresse: string
  plaque: string; marque: string | null; modele: string | null; assistance: boolean; verifie_le: string | null
  garage_id: string | null
  odoo_partner_id: number | null; session_version: number; active: boolean; created_at: string
}

const TVA = 1.21
const r2 = (n: number) => Math.round(n * 100) / 100
const SOC_COLS = 'id, nom, odoo_partner_id, source_key, appel_audio, couleur, clients_actif, clients_slug, clients_source_key'

export async function societeParSlug(slug: string): Promise<SocieteClients | null> {
  const s = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!s) return null
  const { data } = await createAdminClient().from('espace_societes').select(SOC_COLS).eq('clients_slug', s).eq('active', true).maybeSingle()
  return (data as SocieteClients) || null
}

// ── Session du client : cookie signé par garage (un même client peut l'être de deux garages) ──
const DUREE_S = 365 * 24 * 3600
export const clientCookie = (slug: string) => `vd_client_${slug}`
const mac = (p: string) => crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || '').update(`client:${p}`).digest('base64url')
export function signClient(c: Pick<EspaceClient, 'id' | 'session_version'>): string {
  const p = Buffer.from(JSON.stringify({ c: c.id, v: c.session_version })).toString('base64url')
  return `${p}.${mac(p)}`
}
export const clientCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: DUREE_S }

export async function getClientSession(slug: string): Promise<{ client: EspaceClient; societe: SocieteClients } | null> {
  if (!process.env.NEXTAUTH_SECRET) return null
  const societe = await societeParSlug(slug)
  if (!societe) return null
  const t = cookies().get(clientCookie(societe.clients_slug!))?.value
  const [p, sig] = String(t || '').split('.')
  if (!p || !sig) return null
  const want = mac(p)
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  let o: any
  try { o = JSON.parse(Buffer.from(p, 'base64url').toString()) } catch { return null }
  const { data: client } = await createAdminClient().from('espace_clients').select('*').eq('id', String(o?.c || '')).maybeSingle()
  if (!client || !client.active || !client.verifie_le || client.societe_id !== societe.id || Number(client.session_version) !== Number(o?.v)) return null
  return { client: client as EspaceClient, societe }
}

// ── Estimations affichées avant de commander (TVAC) : dépannage sur place, et remorquage jusqu'au garage du
// client quand il est connu (Olivier 10/10/2026). ──
export async function estimations(societe: SocieteClients, client: EspaceClient, lat: number, lng: number): Promise<{ dsp: number | null; rem: number | null; garage: string | null }> {
  const vide = { dsp: null, rem: null, garage: null }
  if (!societe.clients_source_key || !Number.isFinite(lat) || !Number.isFinite(lng)) return vide
  const { withRoutingMode } = await import('@/lib/routing/mode')
  const { depotLoopKm, depotRemKm, estimateMissionPrice } = await import('@/lib/missions/estimate-price')
  const { data: g } = client.garage_id
    ? await createAdminClient().from('espace_garages').select('nom, lat, lng').eq('id', client.garage_id).maybeSingle()
    : { data: null }
  const now = new Date().toISOString()
  const prix = async (mission_type: string, total_km: number, charged_km: number) => {
    const e = await estimateMissionPrice({ source: societe.clients_source_key, mission_type, client_name: null, vehicle_mileage: null, total_km, charged_km, intervention_date: now, received_at: now } as any)
    return e.ok && e.total_eur > 0 ? r2(e.total_eur * TVA) : null
  }
  return withRoutingMode('free', async () => {
    const km = await depotLoopKm({ lat, lng })
    const dsp = km == null ? null : await prix('depannage', km, 0)
    let rem: number | null = null
    if (g?.lat != null && g?.lng != null) {
      const r = await depotRemKm({ lat, lng }, { lat: Number(g.lat), lng: Number(g.lng) })
      rem = r ? await prix('remorquage', r.totalKm, r.chargedKm) : null
    }
    return { dsp, rem, garage: g?.nom || null }
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
    console.error('[clients garage] partenaire KO', e?.message)
    return null
  }
}

export const PANNES = ['Ne démarre pas', 'Batterie', 'Crevaison', 'Accident', 'Bruit / fumée', 'Clés enfermées', 'Autre'] as const

export interface CommandeInput { adresse: string; lat: number; lng: number; panne: string; symptome?: string | null }

export function lireCommande(b: any): CommandeInput | string {
  const adresse = String(b?.adresse || '').trim().slice(0, 300)
  const lat = Number(b?.lat), lng = Number(b?.lng)
  if (!adresse || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'Indiquez où vous êtes.'
  const panne = String(b?.panne || '')
  if (!(PANNES as readonly string[]).includes(panne)) return 'Dites-nous ce qui se passe.'
  const symptome = String(b?.symptome || '').trim().slice(0, 300) || null
  if (panne === 'Autre' && !symptome) return 'Décrivez les symptômes en une ligne.'
  return { adresse, lat, lng, panne, symptome }
}

export async function creerCommande(client: EspaceClient, societe: SocieteClients, d: CommandeInput): Promise<{ id: string; mission_number: number }> {
  const sb = createAdminClient()
  const now = new Date().toISOString()
  const nom = `${client.prenom} ${client.nom}`.trim()
  // Le garage du client (choisi à l'inscription) : destination d'office si la mission devient un remorquage.
  const { data: garages } = await sb.from('espace_garages').select('id, nom, adresse, lat, lng').eq('societe_id', societe.id).order('ordre')
  const sonGarage: any = (garages || []).find((g: any) => g.id === client.garage_id) || (garages?.length === 1 ? garages[0] : null)
  const assistance = client.assistance
  const source = assistance ? societe.source_key : societe.clients_source_key!
  const partner = assistance ? societe.odoo_partner_id : await partenaireClient(client)
  const panne = d.panne === 'Autre' ? `Autre : ${d.symptome}` : d.symptome ? `${d.panne} — ${d.symptome}` : d.panne
  const remarques = [
    `Client du garage ${societe.nom} — commande passée par le client lui-même.`,
    sonGarage ? `Garage du client : ${sonGarage.nom}, ${sonGarage.adresse}. En cas de remorquage, livrer UNIQUEMENT à ce garage.` : null,
    assistance ? `Assistance ${societe.nom} : facturé à ${societe.nom}.` : `Pas d’assistance : le client paie tout au chauffeur (tarif ${societe.nom} + 20 %). Facture au nom du client.`,
    `Panne signalée : ${panne}`,
    `Client : ${nom} — ${client.tel} — ${client.email}`,
    `Adresse du client : ${client.adresse}`,
  ].filter(Boolean).join('\n')
  const { data: gp } = await sb.from('garage_partners').select('id').eq('odoo_partner_id', societe.odoo_partner_id).eq('active', true).limit(1)
  const { data: m, error } = await sb.from('incoming_missions').insert({
    external_id: `CLI-${Date.now().toString(36).toUpperCase()}`,
    source, mission_type: 'depannage', status: 'new',
    vehicle_plate: client.plaque, vehicle_brand: client.marque, vehicle_model: client.modele,
    incident_address: d.adresse, incident_lat: d.lat, incident_lng: d.lng,
    destination_address: sonGarage?.adresse || null, destination_name: sonGarage?.nom || null,
    destination_lat: sonGarage?.lat ?? null, destination_lng: sonGarage?.lng ?? null,
    client_name: nom, client_phone: client.tel,
    assisted_name: nom, assisted_phone: client.tel,
    incident_description: panne,
    requested_by_garage_id: gp?.[0]?.id || null,
    billed_to_id: partner, billed_to_name: assistance ? societe.nom : nom,
    amount_to_collect: null,
    remarks_general: remarques,
    espace_client_id: client.id,
    received_at: now, intervention_date: now, incident_at: now,
    created_at: now, updated_at: now,
  }).select('id, mission_number').single()
  if (error || !m) throw new Error(error?.message || 'Création impossible')
  await sb.from('mission_logs').insert({ mission_id: m.id, action: 'received', notes: `Commande passée par ${nom}, client du garage ${societe.nom} (${assistance ? 'assistance du garage' : 'paiement au chauffeur'}).` }).then(() => {}, () => {})
  if (!assistance) await recalcMontantClient(m.id).catch(() => null)

  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'espace_client_demande', {
    title: `🔧 Dépannage — client ${societe.nom}`,
    body: `${[client.marque, client.modele, client.plaque].filter(Boolean).join(' ')} · ${d.adresse} · ${assistance ? `assistance ${societe.nom}` : 'paiement au chauffeur'} — à valider dans les commandes`,
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
  const { data } = await sb.from('incoming_missions').select(`${MISSION_COLS}, amount_to_collect, payment_collected_at`)
    .eq('espace_client_id', client.id).is('parent_mission_id', null).order('created_at', { ascending: false }).limit(1)
  const m: any = data?.[0]
  if (!m) return null
  const fini = ['completed', 'to_invoice', 'invoiced', 'cancelled'].includes(m.status)
  const ref = m.completed_at || m.cancelled_at || m.updated_at || m.created_at
  if (fini && Date.now() - new Date(ref).getTime() > 24 * 3600_000) return null
  const rel = (await relivraisonsDe([m.id])).get(m.id) || null
  const { data: dem } = await sb.from('garage_cancellation_requests').select('id').eq('mission_id', m.id).eq('status', 'pending').limit(1)
  const parti = !!(m.on_way_at || m.on_site_at || m.loaded_at)
  return {
    id: m.id as string, numero: m.mission_number as number, adresse: m.incident_address as string | null,
    panne: m.incident_description as string | null,
    suivi: suiviClient(m, rel),
    aPayer: m.espace_client_id && !client.assistance && m.amount_to_collect ? Number(m.amount_to_collect) : null,
    deplacementPourRien: isTrajetVide(m.mission_type),
    annulable: !fini && !dem?.length,
    annulationEnCours: !!dem?.length,
    parti,
  }
}

/** Annulation par le client : avant validation, tout de suite ; ensuite, le dispatch tranche (sans frais avant départ, déplacement facturé après). */
export async function annulerCommande(client: EspaceClient, societe: SocieteClients, missionId: string): Promise<{ ok: boolean; message: string }> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, status, vehicle_plate, on_way_at, on_site_at, loaded_at, requested_by_garage_id, espace_client_id')
    .eq('id', missionId).eq('espace_client_id', client.id).maybeSingle()
  if (!m) return { ok: false, message: 'Demande introuvable.' }
  if (['completed', 'to_invoice', 'invoiced', 'cancelled'].includes(m.status)) return { ok: false, message: 'Cette intervention est déjà terminée ou annulée.' }
  const now = new Date().toISOString()
  const nom = `${client.prenom} ${client.nom}`
  if (m.status === 'new') {
    await sb.from('incoming_missions').update({ status: 'cancelled', cancelled_at: now, cancelled_reason: `Annulée par le client (${nom}) avant validation`, updated_at: now }).eq('id', m.id).eq('status', 'new')
    await sb.from('mission_logs').insert({ mission_id: m.id, action: 'cancelled', notes: `Annulée par ${nom}, client du garage ${societe.nom}, avant validation.` }).then(() => {}, () => {})
    await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'espace_client_demande', {
      title: '✕ Demande annulée par le client', body: `#${m.mission_number} ${m.vehicle_plate || ''} — client ${societe.nom}, annulée avant validation.`, action_url: `/dispatch/${m.id}`, mission_id: m.id,
    }).catch(() => {})
    return { ok: true, message: 'Demande annulée, sans frais.' }
  }
  const { data: existe } = await sb.from('garage_cancellation_requests').select('id').eq('mission_id', m.id).eq('status', 'pending').maybeSingle()
  if (existe) return { ok: true, message: 'Votre annulation est déjà en cours.' }
  const parti = !!(m.on_way_at || m.on_site_at || m.loaded_at)
  const frais = parti && !client.assistance
  const { error } = await sb.from('garage_cancellation_requests').insert({
    mission_id: m.id, requested_by_garage_id: m.requested_by_garage_id, requested_by_user_id: null, status: 'pending',
    reason: `Annulation demandée par le client ${nom} (garage ${societe.nom}) — ${parti ? (frais ? 'dépanneur déjà parti : déplacement pour rien à facturer au client' : 'dépanneur déjà parti (assistance du garage)') : 'dépanneur pas encore parti : sans frais'}`,
  })
  if (error) return { ok: false, message: 'L’annulation n’a pas pu être enregistrée. Appelez-nous.' }
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'garage_cancel_request', {
    title: '🛑 Annulation demandée par un client', body: `#${m.mission_number}${m.vehicle_plate ? ' · ' + m.vehicle_plate : ''} — client ${societe.nom}${parti ? ', dépanneur déjà parti' : ''}. À décider.`, action_url: '/admin/garage-cancellations', mission_id: m.id,
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

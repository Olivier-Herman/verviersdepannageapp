// src/lib/sam/core.ts
//
// Sam, l'aide des chauffeurs (Olivier 03/10/2026). VD Soft donne le contexte
// au bureau des agents (POST {MOBIOUEB_ADRESSE}/api/externe/sam) et reste le
// SEUL à agir : une action proposée par Sam ne s'exécute qu'après le « Oui,
// fais-le » du chauffeur, depuis une liste blanche, en rejouant la route
// chauffeur avec SES droits (appel interne de /api/missions/driver-action).
// Le bureau n'a aucun accès à la base.
//
// Canaux : le bouton « Aide » de l'app et Telegram (seulement l'aide, jamais
// les notifications de mission).

import { createAdminClient } from '@/lib/supabase'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import { geocodeAddressServer } from '@/lib/geocode/server'
import { recordExchange } from './journal'

export type SamCanal = 'app' | 'telegram'
export type SamButton = { libelle: string; valeur: string }
export type SamAction = { id: string; parametres: Record<string, any>; libelle: string }
export interface SamReply {
  /** Prénom de l'agent qui répond : « Sam » (8 h-20 h) ou « Sonic » (20 h-8 h), donné par le bureau. */
  agent?: string
  /** Relève en fin de service : message de l'agent qui part, à afficher AVANT la réponse. */
  transfert?: { agent: string; texte: string; texte_fr?: string } | null
  /** Traduction française du message du chauffeur (s'il écrit en albanais). */
  message_fr?: string | null
  texte: string
  texte_fr?: string
  boutons?: SamButton[]
  action?: SamAction | null
  besoin?: { type: 'chercher_plaque'; plaque: string } | null
  panne?: { resume: string; details?: string } | null
}
export interface SamTurn { reply: SamReply; openUrl?: string | null }

// Missions « en cours » d'un chauffeur (même liste que sa page de missions).
/** Sam de 8 h à 20 h, Sonic de 20 h à 8 h (heure de Bruxelles) — Olivier 03/10/2026. */
export function agentDuMoment(d = new Date()): 'Sam' | 'Sonic' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(d)) % 24
  return h >= 8 && h < 20 ? 'Sam' : 'Sonic'
}

/**
 * Agent de service selon le bureau (tient compte de la relève : l'agent qui
 * recevrait une nouvelle conversation). Repli sur l'horaire local 8 h–20 h.
 * Mis en cache 60 s : chaque fiche ouverte interroge toutes les 20 s.
 */
let deServiceCache: { agent: string; at: number } | null = null
export async function agentDeService(): Promise<string> {
  if (deServiceCache && Date.now() - deServiceCache.at < 60_000) return deServiceCache.agent
  const url = process.env.MOBIOUEB_ADRESSE, secret = process.env.MOBIOUEB_EXTERNE_SECRET
  let agent: string = agentDuMoment()
  if (url && secret) {
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/api/externe/sam/de-service`, {
        cache: 'no-store', signal: AbortSignal.timeout(3_000), headers: { Authorization: `Bearer ${secret}` },
      })
      const j = r.ok ? await r.json() : null
      if (typeof j?.agent === 'string' && j.agent.trim()) agent = j.agent.trim().slice(0, 20)
    } catch { /* repli horaire */ }
  }
  deServiceCache = { agent, at: Date.now() }
  return agent
}

const ACTIVE = ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering']
const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/$/, '')

// Liste blanche des actions (jamais clôture, restitution, annulation, montant).
const ACTIONS_POSSIBLES = [
  { id: 'corriger_adresse', libelle: 'Corriger l’adresse de départ ou d’arrivée d’une mission du chauffeur',
    parametres: { mission_id: 'id de la mission', champ: '"incident" (départ) ou "destination" (arrivée)', adresse: 'adresse complète : rue, numéro, code postal, ville' } },
  { id: 'ouvrir_encaissement', libelle: 'Ouvrir l’écran d’encaissement d’une mission du chauffeur (le chauffeur encaisse lui-même)',
    parametres: { mission_id: 'id de la mission' } },
]

async function loadDriver(userId: string) {
  const { data } = await createAdminClient().from('users').select('id, name, surnom, language, active').eq('id', userId).maybeSingle()
  return data
}

const prenom = (u: any) => String(u?.surnom || u?.name || '').trim().split(/\s+/)[0] || 'chauffeur'

async function missionsEnCours(userId: string) {
  const { data } = await createAdminClient().from('incoming_missions')
    .select('id, mission_number, mission_type, vehicle_plate, status')
    .eq('assigned_to', userId).in('status', ACTIVE).order('received_at', { ascending: false }).limit(10)
  return (data || []).map((m: any) => ({ id: m.id, numero: m.mission_number != null ? String(m.mission_number) : '', type: m.mission_type, plaque: m.vehicle_plate, statut: m.status }))
}

/** Une mission que le chauffeur a le droit de voir : la sienne (assignée à lui). */
async function missionDuChauffeur(userId: string, missionId: string) {
  const { data } = await createAdminClient().from('incoming_missions')
    .select('id, mission_number, source, mission_type, status, assigned_to, vehicle_plate, vehicle_brand, vehicle_model, client_name, incident_address, incident_lat, incident_lng, destination_address, destination_lat, destination_lng, amount_to_collect, awaiting_payment, intervention_date, received_at, on_site_at, loaded_at, completed_at, remarks_general')
    .eq('id', missionId).maybeSingle()
  if (!data || (data as any).assigned_to !== userId) return null
  return data as any
}

function erreursConnues(m: any): string[] {
  if (!m) return []
  const e: string[] = []
  if (m.incident_address && (m.incident_lat == null || m.incident_lng == null)) e.push('Adresse de départ non reconnue (pas de position) : le prix et la navigation peuvent bloquer.')
  if (/remorquage|relivraison|transport/i.test(String(m.mission_type || '')) && !m.destination_address) e.push('Pas d’adresse d’arrivée : obligatoire pour clôturer un remorquage.')
  if (m.destination_address && (m.destination_lat == null || m.destination_lng == null)) e.push('Adresse d’arrivée non reconnue (pas de position) : le prix peut rester « à calculer ».')
  if (m.awaiting_payment) e.push('Paiement à recevoir : un montant reste à encaisser.')
  return e
}

function missionUtile(m: any) {
  if (!m) return null
  const { assigned_to, ...rest } = m
  return rest
}

async function getState(userId: string) {
  const { data } = await createAdminClient().from('sam_state').select('*').eq('user_id', userId).maybeSingle()
  return data as any
}
async function setState(userId: string, patch: Record<string, any>) {
  await createAdminClient().from('sam_state').upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

async function callBureau(body: any): Promise<SamReply> {
  const url = process.env.MOBIOUEB_ADRESSE, secret = process.env.MOBIOUEB_EXTERNE_SECRET
  if (!url || !secret) throw new Error('Aide indisponible (configuration)')
  const r = await fetch(`${url.replace(/\/$/, '')}/api/externe/sam`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(55_000),
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Aide indisponible (${r.status}) ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const j = await r.json()
  const transfert = j.transfert && typeof j.transfert.texte === 'string' && j.transfert.texte.trim()
    ? { agent: String(j.transfert.agent || '').slice(0, 20) || 'Sam', texte: String(j.transfert.texte), texte_fr: j.transfert.texte_fr }
    : null
  return { agent: typeof j.agent === 'string' && j.agent.trim() ? j.agent.trim().slice(0, 20) : agentDuMoment(), transfert, message_fr: typeof j.message_fr === 'string' ? j.message_fr : null, texte: String(j.texte || ''), texte_fr: j.texte_fr, boutons: Array.isArray(j.boutons) ? j.boutons.slice(0, 8) : [], action: j.action || null, besoin: j.besoin || null, panne: j.panne || null }
}

/** Recherche par plaque, limitée aux missions du chauffeur. */
async function chercherPlaque(userId: string, plaque: string) {
  const p = String(plaque || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (p.length < 3) return { trouvees: [], note: 'plaque trop courte' }
  const { data } = await createAdminClient().from('incoming_missions')
    .select('id, mission_number, mission_type, vehicle_plate, status, received_at')
    .eq('assigned_to', userId).ilike('vehicle_plate', `%${p}%`).order('received_at', { ascending: false }).limit(5)
  return { trouvees: (data || []).map((m: any) => ({ id: m.id, numero: m.mission_number != null ? String(m.mission_number) : '', type: m.mission_type, plaque: m.vehicle_plate, statut: m.status })) }
}

/**
 * Un tour de conversation : texte (ou libellé de bouton) du chauffeur → réponse
 * de Sam. `resultat` = résultat d'une action ou d'une recherche à transmettre.
 */
export async function samTurn(opts: { userId: string; canal: SamCanal; texte: string; photo?: string | null; ecran?: string | null; missionId?: string | null; resultat?: any; endAfter?: 'action' | null }): Promise<SamTurn> {
  const u = await loadDriver(opts.userId)
  if (!u || !u.active) throw new Error('Compte inactif')
  const state = await getState(opts.userId)
  // Une action attend : « Oui, fais-le » / « Non » (tapé ou bouton de Sam) vaut réponse à l'action.
  if (state?.pending_action && opts.resultat === undefined) {
    const t = String(opts.texte || '').trim().toLowerCase()
    if (/^(oui|ok|vas-?y|fais-?le|po\b|po,|bëje|yes)/.test(t)) return samConfirm({ userId: opts.userId, canal: opts.canal, oui: true })
    if (/^(non|jo\b|no\b|je le fais)/.test(t)) return samConfirm({ userId: opts.userId, canal: opts.canal, oui: false })
  }
  const encours = await missionsEnCours(opts.userId)
  // Mission discutée : celle de l'écran, sinon celle retenue au tour précédent, sinon la seule en cours.
  let missionId = opts.missionId || state?.mission_id || (encours.length === 1 ? encours[0].id : null)
  // Un bouton « mission » touché : sa valeur est l'id de la mission.
  const touched = (state?.buttons || []).find((b: SamButton) => b.libelle === opts.texte)
  if (touched && encours.some(m => m.id === touched.valeur)) missionId = touched.valeur
  const mission = missionId ? await missionDuChauffeur(opts.userId, missionId) : null
  if (!mission) missionId = null

  let resultat = opts.resultat ?? (touched ? { bouton: touched.valeur } : null)
  let reply: SamReply | null = null
  for (let i = 0; i < 3; i++) {
    reply = await callBureau({
      chauffeur: { id: u.id, prenom: prenom(u), langue: u.language === 'sq' ? 'sq' : 'fr' },
      canal: opts.canal, texte: opts.texte, photo: i === 0 ? (opts.photo || undefined) : undefined,
      contexte: { ecran: opts.ecran || (opts.canal === 'telegram' ? 'Telegram' : null), mission: missionUtile(mission), missions_en_cours: encours, erreurs: erreursConnues(mission), actions_possibles: ACTIONS_POSSIBLES, resultat },
    })
    if (reply.besoin?.type === 'chercher_plaque') { resultat = { recherche_plaque: reply.besoin.plaque, ...(await chercherPlaque(opts.userId, reply.besoin.plaque)) }; continue }
    break
  }
  if (!reply) throw new Error('Pas de réponse')
  // Action proposée : gardée en attente, seulement si elle est dans la liste blanche.
  const action = reply.action && ACTIONS_POSSIBLES.some(a => a.id === reply!.action!.id) ? reply.action : null
  if (reply.action && !action) reply.action = null
  if (action) {
    // Paramètres manquants : la mission de la conversation par défaut.
    action.parametres = { ...(action.parametres || {}) }
    if (!action.parametres.mission_id && missionId) action.parametres.mission_id = missionId
    reply.boutons = (reply.boutons || []).filter(b => !/^(oui|non|po|jo)\b/i.test(b.libelle.trim()))
  }
  await setState(opts.userId, { mission_id: missionId, buttons: reply.boutons || [], pending_action: action })
  // Conversation gardée dans VD Soft (fiche de la mission, ou profil du chauffeur).
  await recordExchange({ userId: opts.userId, missionId, canal: opts.canal, texte: opts.texte, photo: !!opts.photo, reply, endAfter: opts.endAfter || null })
  return { reply }
}

/** « Oui, fais-le » : exécute l'action en attente avec les droits du chauffeur, puis rend la main à Sam. */
export async function samConfirm(opts: { userId: string; canal: SamCanal; oui: boolean }): Promise<SamTurn> {
  const state = await getState(opts.userId)
  const action: SamAction | null = state?.pending_action || null
  if (!action) return samTurn({ userId: opts.userId, canal: opts.canal, texte: opts.oui ? 'Oui, fais-le' : 'Non', resultat: { erreur: 'aucune action en attente' } })
  await setState(opts.userId, { pending_action: null })
  if (!opts.oui) return samTurn({ userId: opts.userId, canal: opts.canal, texte: 'Non', resultat: { action: action.id, fait: false, raison: 'refusée par le chauffeur' } })
  const res = await executeAction(opts.userId, action)
  // Une action réussie termine la conversation (Olivier 03/10/2026).
  const turn = await samTurn({ userId: opts.userId, canal: opts.canal, texte: 'Oui, fais-le', resultat: { action: action.id, ...res.resultat }, endAfter: res.resultat?.fait === true ? 'action' : null })
  return { ...turn, openUrl: res.openUrl || null }
}

async function executeAction(userId: string, a: SamAction): Promise<{ resultat: any; openUrl?: string }> {
  const p = a.parametres || {}
  const mission = p.mission_id ? await missionDuChauffeur(userId, String(p.mission_id)) : null
  if (!mission) return { resultat: { fait: false, raison: 'mission introuvable ou pas à ce chauffeur' } }

  if (a.id === 'ouvrir_encaissement') {
    const url = `${APP_URL()}${buildEncaissementUrl(mission)}`
    return { resultat: { fait: true, lien: url }, openUrl: url }
  }

  if (a.id === 'corriger_adresse') {
    const field = p.champ === 'destination' ? 'destination' : p.champ === 'incident' ? 'incident' : null
    const adresse = String(p.adresse || '').trim()
    if (!field || adresse.length < 6) return { resultat: { fait: false, raison: 'paramètres invalides' } }
    // Comme une suggestion choisie dans l'app : l'adresse doit être reconnue (position connue).
    const hit = await geocodeAddressServer(adresse)
    if (!hit || (hit.confidence ?? 0) < 0.8) return { resultat: { fait: false, raison: 'adresse non reconnue : à choisir dans les suggestions de l’app' } }
    // Même route que l'app chauffeur, au nom du chauffeur : mêmes contrôles de droits.
    const r = await fetch(`${APP_URL()}/api/missions/driver-action`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '', 'x-internal-actor': userId },
      body: JSON.stringify({ mission_id: mission.id, action: 'update_address', field, value: hit.label, lat: hit.lat, lng: hit.lng }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { resultat: { fait: false, raison: j.error || `refusé (${r.status})` } }
    return { resultat: { fait: true, adresse: hit.label } }
  }
  return { resultat: { fait: false, raison: 'action non autorisée' } }
}

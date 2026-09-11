// src/lib/dossier/build.ts
//
// Construit un DOSSIER à partir de n'importe quelle fiche de la chaîne :
// la racine (REM), ses actions (REL…), ses séjours au parc (fiches gardiennage
// créées par le trigger dossier_gardiennage_sync) et les mails sans action
// (annulés / ignorés / orphelins rattachés par la plaque dans la fenêtre du
// dossier). Chaque action ou séjour reçoit une LETTRE chronologique : le
// numéro du dossier ne change pas, on ajoute la lettre derrière (10114107A,
// 10114107B…), sans tiret. Olivier 07/09/2026.
//
// LECTURE SEULE. Calculs d'estimation par groupe pour que chaque fiche montre
// le total du dossier sans additionner à la main.

import { createAdminClient }   from '@/lib/supabase'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'
import { actionLines, linesTotal } from '@/lib/dossier/lines'
import { getMissionTypeLabel }  from '@/lib/missions/mission-types'
import { getBusinessNumber } from '@/lib/settings/business'

export type LegKind = 'rem' | 'gard' | 'rel' | 'out'

export interface DossierLeg {
  letter:          string
  kind:            LegKind
  mission_id:      string
  mission_number:  number | null
  external_id:     string | null
  dossier_number:  string | null
  title:           string
  subtitle:        string
  status:          string
  status_label:    string
  status_tone:     'ok' | 'warn' | 'live' | 'bad' | 'muted'
  started_at:      string | null
  ended_at:        string | null
  open:            boolean
  driver_name:     string | null
  billed_to_id:    number | null
  billed_to_name:  string | null
  billed_inherited: boolean
  facts:           { label: string; value: string }[]
  // Estimation HTVA de CE groupe + ce qui est déjà facturé dessus.
  amount_htva:     number
  amount_note:     string | null
  billed_htva:     number
  billed_refs:     string[]
  nothing_to_bill: string | null
  days:            number | null
  regime:          string | null
  alerts?:         string[]        // D10 : alertes du module classique (montant à 0 sur place, écart encaissé, multi-paiements, Siabis non tranché)
  free_days?:      number          // jours offerts du tarif gardiennage (pour couper une période sans les recompter)
  // Adresse de relivraison : portée par la mise en parc (Olivier 07/09 : « c'est la
  // mise en parc qui contient les infos de relivraison ») — lue sur la racine.
  redelivery_address: string | null
  // Montant que le moteur de facturation ne sait pas produire (km inconnus,
  // destination non géocodée, tarif introuvable) → « à calculer », avec la
  // raison dans amount_note. En mode léger pur, dit aussi « pas de montant figé ».
  amount_unknown?: boolean
  // Canal de facturation : Odoo (défaut), relevé trimestriel Domaine, état de
  // frais Parquet. Seul 'odoo' passe par la modale « Facturer » du dossier.
  channel?:        'odoo' | 'domaine' | 'parquet'
  // Champs modifiables d'un clic dans le résumé du groupe (Olivier 07/09 :
  // « tout doit être modifiable en cliquant sur l'objet »). Les adresses
  // passent par la fiche (géocodage navigateur).
  editable?:       {
    client_name: string | null; client_phone: string | null; client_address: string | null
    assisted_name: string | null; assisted_phone: string | null
    vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; vehicle_vin: string | null
    vehicle_fuel: string | null; vehicle_gearbox: string | null; vehicle_mileage: string | null
    incident_address: string | null; destination_address: string | null; destination_name: string | null; redelivery_address: string | null
    mission_type: string | null; source: string | null; dossier_number: string | null; intervention_date: string | null
    incident_type: string | null; incident_description: string | null; remarks_general: string | null
      incident_has_coords?: boolean; destination_has_coords?: boolean; redelivery_has_coords?: boolean
  }
  // Remarques de facturation (dispatch) : à confirmer AVANT de facturer.
  billing_remarks: { text: string; author: string | null; at: string | null }[]
  // Encaissements chauffeur liés à cette fiche (table interventions).
  payments: { amount: number; mode: string | null; at: string | null; driver: string | null }[]
}

export interface DossierEvent {
  at:         string
  mission_id: string
  source:     string | null
  label:      string
  detail:     string | null
  kind:       'cancelled' | 'ignored' | 'a_verifier' | 'orphan' | 'autre_dossier' | 'levee'
  mission_number?: number | null
  status?:    string
}

export interface Dossier {
  root_id:        string
  ref:            string            // « #10114107 »
  number:         number | null
  dossier_number: string | null
  source:         string | null
  source_label:   string
  vehicle:        { plate: string | null; brand: string | null; model: string | null; vin: string | null }
  client:         { name: string | null; phone: string | null }
  billed_to:      { id: number | null; name: string | null }
  received_at:    string | null
  state:          { open: boolean; reason: string | null }
  // Dernier séjour au parc, même après la sortie (Olivier 08/09/2026 : « on ne voit plus dans quel parc elle était »).
  last_parc?:     { zone: string | null; entered_at: string | null; exited_at: string | null; reason: string | null; letter: string } | null
  // Tampons de la page Facturation : Domaine (vendu), ANWB / Touring check.
  stamps:         { domaine: string | null; touring_check: string | null }
  // Circuit Parquet / Domaine (module Saisie) : états de frais, jamais de facture Odoo.
  parquet?:       { recipient: string; state: string | null; ef_number: number | null; billed_to_date: string | null; depannage_billed: boolean;
                    efs: { numero: number | null; from: string | null; to: string | null; total_htva: number; status: string | null; justinvoice: string | null; liquide_at: string | null; include_depannage: boolean }[] }
  legs:           DossierLeg[]
  events:         DossierEvent[]
  totals:         { estimated: number; billed: number; collected: number; remaining: number; due_tvac: number }   // collected est TVAC (encaissé sur place) ; due_tvac = estimé TVAC − encaissé
  light?:         boolean
  invoices:       { number: string; covers: string[]; client: string | null; amount: number; at: string | null; url: string | null }[]
}

import { nightsBetween } from '@/lib/parc/nights'

const DAY_MS = 86_400_000
const ts  = (v: string | null | undefined) => (v ? new Date(v).getTime() : null)
const r2  = (n: number) => Math.round(n * 100) / 100
const fmtD = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const normPlate = (p: string | null | undefined) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const REGIME_LABEL: Record<string, string> = { assistance: 'assistance', saisie: 'saisie', siabis: 'Siabis', autre: 'autre' }

// (Historique : liste de colonnes explicite ; remplacée par '*' le 07/09/2026 —
// les constructeurs de lignes (montants forcés, Siabis, brouillons) lisent des
// champs qui n'y figuraient pas et le dossier divergeait de la facture.)
const CHAIN_COLS_LEGACY = `id, mission_number, external_id, dossier_number, source, source_format, status, mission_type, incident_type,
  parent_mission_id, dossier_leg, parc_origin_mission_id, parc_exit_at, parc_exit_reason,
  vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, vehicle_class, vehicle_mileage,
  client_name, client_phone, billed_to_id, billed_to_name,
  incident_address, destination_address, destination_name, redelivery_address, garage_reopen_date,
  assigned_to, received_at, intervention_date, on_way_at, on_site_at, loaded_at, delivering_at, parked_at, completed_at, cancelled_at,
  parc_zone_key, parc_row_number, parc_slot_index, key_location, keys_digibox_slot, saisie_key_hook, label_printed_at,
  requisitoire_at, requisitoire_reminder_count, levee_saisie_date, domaine_remise_date, domaine_enlevement_date,
  storage_waived, storage_flat_htva, special_tarif_htva, estimated_htva,
  driver_photos, remarks_general, closing_notes, client_signature, client_signature_name, cancelled_reason,
  invoice_number, invoice_url, invoiced_at, invoice_odoo_id, invoice_created_at, payment_amount, amount_collected, payment_mode,
  snc_scenario, snc_requires_balisage, incident_lat, incident_lng, destination_lat, destination_lng, temp_returned_at, is_rollable`

function kindOf(m: any): LegKind {
  if (m.dossier_leg) return 'gard'
  const t = String(m.mission_type || '').toLowerCase()
  if (t.includes('reliv') || t === 'rel') return 'rel'
  return 'rem'
}

function statusOf(m: any, kind: LegKind): { label: string; tone: DossierLeg['status_tone'] } {
  if (kind === 'gard') {
    if (!m.parc_exit_at) return { label: 'Gardiennage en cours', tone: 'live' }
    if (m.invoice_number) return { label: `Facturé ${m.invoice_number}`, tone: 'ok' }
    return { label: 'Terminé · à facturer', tone: 'warn' }
  }
  switch (m.status) {
    case 'completed':   return { label: m.invoice_number ? `Facturée ${m.invoice_number}` : 'Terminée', tone: 'ok' }
    case 'to_invoice':  return { label: 'À facturer', tone: 'warn' }
    case 'parked':      return { label: 'Au parc', tone: 'live' }
    case 'delivering':  return { label: m.loaded_at ? 'Chargé · en livraison' : 'En livraison', tone: 'live' }
    // « En cours » ne dit rien : on montre l'étape du chauffeur (Olivier 07/09).
    case 'in_progress': return { label: m.loaded_at ? 'Chargé sur camion' : m.on_site_at ? 'Sur place' : m.on_way_at ? 'En route' : 'En cours', tone: 'live' }
    case 'assigned': case 'accepted': return { label: 'Assignée', tone: 'live' }
    case 'dispatching': case 'new':   return { label: 'À assigner', tone: 'muted' }
    case 'cancelled':   return { label: 'Annulée', tone: 'bad' }
    case 'ignored':     return { label: 'Ignorée', tone: 'muted' }
    default:            return { label: m.status || '—', tone: 'muted' }
  }
}

// Clé de tri chronologique : ce qui a réellement démarré le groupe.
function startKey(m: any, kind: LegKind): number {
  if (kind === 'gard') return ts(m.parked_at) || ts(m.received_at) || 0
  if (kind === 'rel')  return ts(m.loaded_at) || ts(m.on_way_at) || ts(m.received_at) || 0
  return ts(m.received_at) || ts(m.intervention_date) || 0
}

// `light` : ouverture rapide de la FICHE — pas de moteur de prix (routage), on
// prend le montant figé (special_tarif_htva / estimated_htva) ; pas de recherche
// d'orphelins par plaque, pas de relecture Odoo. La fiche recalcule ensuite en
// arrière-plan.
// `price` : garde les raccourcis du léger MAIS calcule quand même les montants
// avec le moteur de facturation. C'est le mode de la LISTE Facturation par
// dossier : c'est de là qu'on facture, donc le montant doit être le vrai
// (Olivier 09/09/2026 : 2JAK599 / 2CMX015 / 1DMC939 affichaient « à calculer »
// alors que la fiche calculait bien — le figé estimated_htva était vide ou 0).
// Cache mémoire pour la LISTE Facturation par dossier
// (Olivier 08/09/2026 : « l'affichage de la page facturation est très long »).
// Uniquement sur demande (opts.cache) : les routes qui décident (facturer,
// marquer, clôturer) lisent toujours frais. Une construction complète
// rafraîchit l'entrée. La clé porte le mode : un dossier tarifé ne doit jamais
// être servi à la place d'un dossier figé, ni l'inverse.
const LIGHT_CACHE = new Map<string, { at: number; d: Dossier }>()
const LIGHT_TTL_MS = 90_000
const cacheKeyFor = (id: string, price: boolean) => `${id}|${price ? 'p' : 'l'}`
export function invalidateDossierCache(rootId?: string) {
  if (rootId) { LIGHT_CACHE.delete(cacheKeyFor(rootId, true)); LIGHT_CACHE.delete(cacheKeyFor(rootId, false)) }
  else LIGHT_CACHE.clear()
}

export async function buildDossier(anyMissionId: string, opts: { light?: boolean; price?: boolean; cache?: boolean } = {}): Promise<Dossier | null> {
  const light = !!opts.light
  const price = !!opts.price
  const key   = cacheKeyFor(anyMissionId, price)
  if (light && opts.cache) {
    const hit = LIGHT_CACHE.get(key)
    if (hit && Date.now() - hit.at < LIGHT_TTL_MS) return hit.d
  }
  const built = await buildDossierUncached(anyMissionId, light, price)
  if (built) {
    if (light && opts.cache) LIGHT_CACHE.set(key, { at: Date.now(), d: built })
    else invalidateDossierCache(built.root_id)   // une lecture fraîche remplace l'entrée
  }
  return built
}

async function buildDossierUncached(anyMissionId: string, light: boolean, price = false): Promise<Dossier | null> {
  // Montants calculés par le moteur de facturation : toujours, sauf en mode
  // léger pur (ouverture rapide de la fiche).
  const priced = !light || price
  const sb = createAdminClient()

  const { data: m0, error: e0 } = await sb.from('incoming_missions').select('*').eq('id', anyMissionId).maybeSingle()
  if (e0) console.error('[dossier/build]', e0.message)
  if (!m0) return null
  // Racine = on remonte la chaîne des parents (une REL de REL a pour parent une
  // REL, pas le remorquage : 2ERT632, 08/09/2026).
  let root: any = m0
  for (let hop = 0; hop < 6 && root?.parent_mission_id; hop++) {
    const { data: p } = await sb.from('incoming_missions').select('*').eq('id', root.parent_mission_id).maybeSingle()
    if (!p) break
    root = p
  }

  // Descendants à tous les niveaux : REL du REM, REL de la REL (remise en parc
  // puis nouvelle relivraison), fiches Gardiennage… — pas seulement les enfants directs.
  const kids: any[] = []
  {
    let frontier = [root.id]
    const seen = new Set<string>([root.id])
    for (let depth = 0; depth < 6 && frontier.length; depth++) {
      const { data: lvl } = await sb.from('incoming_missions').select('*').in('parent_mission_id', frontier).order('received_at', { ascending: true })
      const next: string[] = []
      for (const k of lvl || []) { if (seen.has(k.id)) continue; seen.add(k.id); kids.push(k); next.push(k.id) }
      frontier = next
    }
    kids.sort((a, b) => String(a.received_at || '').localeCompare(String(b.received_at || '')))
  }

  const DEAD = new Set(['cancelled', 'ignored', 'parse_error', 'duplicate'])
  const legRows: any[] = [root, ...kids.filter(k => k.dossier_leg || !DEAD.has(k.status))]
  const eventRows: any[] = kids.filter(k => !k.dossier_leg && DEAD.has(k.status))

  // ── Fenêtre du dossier : orphelins rattachés par la plaque ──────────────
  const chainIds = new Set([root.id, ...kids.map(k => k.id)])
  const legs0 = legRows.filter(r => r.dossier_leg)
  const lastExit = legs0.length
    ? (legs0.some(l => !l.parc_exit_at) ? null : Math.max(...legs0.map(l => ts(l.parc_exit_at) || 0)))
    : (ts(root.completed_at) || null)
  const winFrom = (ts(root.received_at) || Date.now()) - 3 * DAY_MS
  const winTo   = (lastExit == null ? Date.now() : lastExit) + 7 * DAY_MS
  const plate = normPlate(root.vehicle_plate)
  if (!light && plate.length >= 4) {
    const { data: same } = await sb.from('incoming_missions')
      .select('id, mission_number, source, status, mission_type, dossier_number, received_at, cancelled_reason, closing_notes, vehicle_plate, parent_mission_id, dossier_leg')
      .is('parent_mission_id', null).eq('dossier_leg', false)
      .gte('received_at', new Date(winFrom).toISOString()).lte('received_at', new Date(winTo).toISOString())
      .ilike('vehicle_plate', `%${root.vehicle_plate?.replace(/[-\s]/g, '')?.slice(0, 3) || plate.slice(0, 3)}%`)
      .limit(60)
    for (const s of same || []) {
      if (chainIds.has(s.id) || normPlate(s.vehicle_plate) !== plate) continue
      const sameDossier = root.dossier_number && s.dossier_number && String(root.dossier_number).trim() === String(s.dossier_number).trim()
      const otherDossier = root.dossier_number && s.dossier_number && !sameDossier
      // Une fiche vivante (assignée, terminée, facturée…) pour la même plaque
      // n'est pas « un mail sans action » : c'est un AUTRE dossier, on le
      // signale sans le rattacher.
      const isDead = DEAD.has(s.status) || s.status === 'new'
      eventRows.push({ ...s, _orphan: true, _verify: !!otherDossier, _other: !isDead })
    }
  }

  // ── Noms chauffeurs + libellé source ─────────────────────────────────────
  const driverIds = Array.from(new Set(legRows.map(x => x.assigned_to).filter(Boolean)))
  const nameById: Record<string, string> = {}
  if (driverIds.length) {
    const { data: us } = await sb.from('users').select('id, name').in('id', driverIds)
    for (const u of us || []) nameById[(u as any).id] = (u as any).name
  }
  const { data: cat } = await sb.from('mission_source_catalog').select('key, label')
  const srcLabel: Record<string, string> = {}
  for (const c of cat || []) srcLabel[(c as any).key] = (c as any).label
  const sourceLabel = (k: string | null) => (k ? srcLabel[k] || k : '—')

  // ── Facturé / encaissé ───────────────────────────────────────────────────
  const ids = legRows.map(r => r.id)
  const draftsBy: Record<string, any[]> = {}
  // Les brouillons priment sur tout le reste : dès qu'on tarife, il faut les lire.
  if (priced) {
    const { data: drafts } = await sb.from('mission_invoice_drafts').select('mission_id, lines').in('mission_id', ids)
    for (const dr of drafts || []) if (Array.isArray((dr as any).lines) && (dr as any).lines.length) draftsBy[(dr as any).mission_id] = (dr as any).lines
  }
  // Encaissements chauffeur (mêmes lignes que la page Facturation).
  const { data: pays } = await sb.from('interventions')
    .select('mission_id, amount, payment_mode, created_at, driver_id').in('mission_id', ids)
  const payBy: Record<string, any[]> = {}
  for (const pz of pays || []) (payBy[(pz as any).mission_id] ||= []).push(pz)
  const payDriverIds = Array.from(new Set((pays || []).map((pz: any) => pz.driver_id).filter(Boolean)))
  if (payDriverIds.length) {
    const { data: us2 } = await sb.from('users').select('id, name').in('id', payDriverIds)
    for (const u of us2 || []) nameById[(u as any).id] = (u as any).name
  }
  const { data: items } = await sb.from('mission_billed_items')
    .select('mission_id, kind, label, qty, amount_htva, period_from, period_to, invoice_number, billed_to_name, billed_at, odoo_quote_id, invoice_odoo_id, dossier_letter')
    .in('mission_id', ids)
  // Brouillons Odoo devenus factures : on ramène le numéro posté maintenant
  // (best effort, 4 s max) plutôt que d'attendre le cron. Olivier 08/09/2026.
  if (!light) {
    const draftIds = Array.from(new Set([
      ...legRows.filter(r => r.invoice_odoo_id && !r.invoice_number).map(r => Number(r.invoice_odoo_id)),
      ...(items || []).filter((it: any) => it.invoice_odoo_id && !it.invoice_number).map((it: any) => Number(it.invoice_odoo_id)),
    ]))
    if (draftIds.length) {
      try {
        const { syncDraftInvoiceNumbers } = await import('@/lib/odoo-invoice')
        const names = await Promise.race([syncDraftInvoiceNumbers(sb, draftIds), new Promise<Record<number, string>>(res => setTimeout(() => res({}), 4000))])
        for (const r of legRows) if (r.invoice_odoo_id && !r.invoice_number && names[Number(r.invoice_odoo_id)]) r.invoice_number = names[Number(r.invoice_odoo_id)]
        for (const it of (items || []) as any[]) if (it.invoice_odoo_id && !it.invoice_number && names[Number(it.invoice_odoo_id)]) it.invoice_number = names[Number(it.invoice_odoo_id)]
      } catch { /* le cron repassera */ }
    }
  }
  // Une facture Odoo encore en brouillon n'a pas de numéro : on la désigne par
  // son id Odoo jusqu'à ce que le cron verify-invoices ramène le numéro posté.
  const refOf = (it: any) => it.invoice_number || (it.invoice_odoo_id ? `brouillon Odoo #${it.invoice_odoo_id}` : it.odoo_quote_id ? `devis Odoo #${it.odoo_quote_id}` : null)
  const ODOO_URL = process.env.ODOO_URL || ''
  const draftUrl = (id: number) => ODOO_URL ? `${ODOO_URL}/web#id=${id}&model=account.move&view_type=form` : null
  const itemsBy: Record<string, any[]> = {}
  for (const it of items || []) (itemsBy[(it as any).mission_id] ||= []).push(it)
  // Facture partielle du module classique : ses jours de parc (SERV-PARC, sans
  // lettre de groupe) sont posés sur la fiche racine. Quand le dossier a ses
  // groupes gardiennage, on les rattache au groupe dont la période les couvre,
  // sinon le gardiennage ressort « à facturer » alors qu'il l'est (HSAV6087, 09/09/2026).
  const gardLegs = legRows.filter(r => r.dossier_leg)
  if (gardLegs.length) {
    for (const rootId0 of Object.keys(itemsBy)) {
      const keep: any[] = []
      for (const it of itemsBy[rootId0]) {
        if (it.kind !== 'SERV-PARC' || it.dossier_letter || !it.period_from) { keep.push(it); continue }
        const from = ts(`${String(it.period_from).slice(0, 10)}T12:00:00Z`)!
        const leg = gardLegs.find(g => g.parc_origin_mission_id === rootId0 || g.parent_mission_id === rootId0)
          && gardLegs.filter(g => (ts(g.parked_at) || 0) <= from + 86_400_000 && (!g.parc_exit_at || ts(g.parc_exit_at)! >= from - 86_400_000)).sort((a, b) => (ts(b.parked_at) || 0) - (ts(a.parked_at) || 0))[0]
        if (leg) (itemsBy[leg.id] ||= []).push({ ...it, dossier_letter: null }); else keep.push(it)
      }
      itemsBy[rootId0] = keep
    }
  }

  // ── Tarif journalier du gardiennage par régime (lignes SERV-PARC) ────────
  // Deux lignes par régime : voiture et cyclo (« cyclo » dans le libellé). On
  // prend celle qui correspond à la classe du véhicule du dossier.
  const { data: parcLines } = await sb.from('source_tariff_lines')
    .select('mission_type, name, default_price, free_days, effective_to')
    .eq('source', 'gardiennage').eq('kind', 'SERV-PARC')
  const isMoto = String(root.vehicle_class || '').toLowerCase() === 'moto'
  const dayPriceByRegime: Record<string, { price: number; free: number }> = {}
  for (const l of parcLines || []) {
    if ((l as any).effective_to && ts((l as any).effective_to)! < Date.now()) continue
    const cyclo = /cyclo|moto|2 roues/i.test(String((l as any).name || ''))
    if (cyclo !== isMoto) continue
    dayPriceByRegime[(l as any).mission_type] = { price: Number((l as any).default_price || 0), free: Number((l as any).free_days || 0) }
  }

  // ── Frais de justice : la levée de saisie ne sort pas le dossier de l'EDF ──
  // Règle Olivier 09/09/2026 : « si un dossier a une levée de saisie, il quitte
  // le modèle EDF SAUF si ce sont des frais de justice (saisie judiciaire pour
  // vol par exemple) ; il est déterminé parce que le client facturé devient
  // Frais de justice ». C'est donc le PAYEUR qui tranche, pas le motif : tant
  // qu'il est « Frais de justice », tout continue de partir en état de frais —
  // tarif de gardiennage saisie compris — et rien ne bascule vers une facture
  // Odoo au client.
  // Olivier 09/09/2026 : « si le client facturé est l'id 67 (Frais de Justice
  // Verviers) ». On accepte aussi le nom : un id Odoo ne survit pas à un
  // changement d'instance, alors que le libellé, si (même raison que les
  // relances, qui matchent l'étiquette par son nom).
  const FRAIS_JUSTICE_ODOO_ID = await getBusinessNumber('odoo_partner_frais_justice')
  // La levée pose désormais la question « frais de justice ou client ? » et
  // enregistre la réponse : elle fait foi. Les levées antérieures n'ont rien
  // enregistré — on retombe alors sur le client facturé, comme avant.
  const isFraisDeJustice = root.levee_saisie_payer
    ? root.levee_saisie_payer === 'frais_justice'
    : [root, ...legRows].some(r =>
        Number((r as any)?.billed_to_id) === FRAIS_JUSTICE_ODOO_ID
        || /frais\s*de\s*justice/i.test(String((r as any)?.billed_to_name || '')))

  // ── Circuit Parquet / Domaine (saisies) : dossier saisie + états de frais ──
  let parquet: Dossier['parquet'] | undefined
  if (String(root.source || '') === 'police_saisie' || root.saisie_motif_code) {
    const { data: sd } = await sb.from('saisie_dossiers').select('id, recipient, state, ef_number, billed_to_date, depannage_billed, justinvoice_ref')
      .eq('mission_id', root.id).maybeSingle()
    if (sd) {
      const { data: efs } = await sb.from('saisie_etats_frais').select('numero, period_from, period_to, total_htva, status, justinvoice_ref, liquide_at, include_depannage')
        .eq('dossier_id', (sd as any).id).order('numero', { ascending: true })
      parquet = {
        recipient: String((sd as any).recipient || 'parquet'), state: (sd as any).state || null, ef_number: (sd as any).ef_number ?? null,
        billed_to_date: (sd as any).billed_to_date || null, depannage_billed: !!(sd as any).depannage_billed,
        efs: (efs || []).map((e: any) => ({ numero: e.numero ?? null, from: e.period_from || null, to: e.period_to || null, total_htva: r2(Number(e.total_htva || 0)), status: e.status || null, justinvoice: e.justinvoice_ref || null, liquide_at: e.liquide_at || null, include_depannage: !!e.include_depannage })),
      }
    } else {
      // Saisie sans dossier Saisie (fiches historiques) : le circuit reste le
      // Parquet / Domaine, jamais une facture Odoo au client (Olivier 08/09/2026 :
      // « pourquoi la liste affiche des dossiers en Domaine ? »). Vendue au
      // Domaine → archivée sans facturation, seul le relevé Domaine s'applique
      // (décision Olivier 08/09/2026).
      parquet = { recipient: 'parquet', state: null, ef_number: null, billed_to_date: null, depannage_billed: false, efs: [] } as any
    }
  }
  const EF_STATUS: Record<string, string> = { envoye: 'envoyé au Parquet', depose: 'déposé (JustInvoice)', refuse: 'refusé', liquide: 'liquidé', brouillon: 'brouillon' }

  // Estimation du REM racine (sert de repli pour le prix/jour et donne la part
  // hors gardiennage).
  // Estimation racine : calculée dans le précalcul parallèle ci-dessous (prix
  // du jour de parc en repli). On la lit après.
  let rootEst: any = null

  // ── Précalcul en parallèle (lignes de facturation + estimation par action) ──
  // En série, chaque fiche coûtait 1 à 2 s de routage ; un dossier à trois
  // groupes mettait 4 s à s'ouvrir (Olivier 07/09 : « fort long »).
  const pre = new Map<string, { est: any; built: { lines: any[]; has_tariff: boolean; reason?: string; failed?: boolean } | null }>()
  await Promise.all(legRows.map(async (m) => {
    if (kindOf(m) === 'gard' || !priced) { pre.set(m.id, { est: null, built: null }); return }
    const [est, built] = await Promise.all([
      (m.id === root.id && rootEst) ? Promise.resolve(rootEst) : estimateMissionPrice(m).catch(() => null),
      // Une EXCEPTION (requête qui tombe, moteur indisponible) n'est pas un
      // verdict tarifaire : `failed` la distingue d'un « pas de tarif », pour
      // ne pas afficher « à calculer » sur une fiche parfaitement chiffrable.
      actionLines(m, draftsBy[m.id], legRows.some(r => r.dossier_leg))
        .catch((e: any) => ({ lines: [], has_tariff: false, reason: e?.message, failed: true })),
    ])
    pre.set(m.id, { est, built })
  }))

  rootEst = pre.get(root.id)?.est ?? null

  // ── Construction des groupes ─────────────────────────────────────────────
  // Siabis NON couvert (source police_snc) : Touring est posé par défaut sur la
  // fiche mais c'est le client sur place qui paie ; on ne montre donc pas
  // Touring comme client à facturer (Olivier 08/09/2026, #10133979). Le couvert
  // (sia_couvert) garde Touring.
  const payer = (r: any): { id: number | null; name: string | null } =>
    String(root.source || '') === 'police_snc' && /touring/i.test(String(r?.billed_to_name || ''))
      ? { id: null, name: null }
      : { id: r?.billed_to_id ?? null, name: r?.billed_to_name ?? null }
  const legs: DossierLeg[] = []
  for (const m of legRows) {
    const kind = kindOf(m)
    const st = statusOf(m, kind)
    const billedItems = itemsBy[m.id] || []
    const billedHtva = r2(billedItems.reduce((s, it) => s + Number(it.amount_htva || 0), 0))
    // « Auto-facturation » (clôture Allianz Hexalite, compagnie qui se facture
    // elle-même) : pas de numéro chez nous, mais la fiche est bel et bien
    // réglée — 0048MLL ressortait « Éligible auto » après coup.
    const autoFact = String(m.invoice_method || '') === 'auto' && !!m.invoiced_at && !m.invoice_number
    const billedRefs = Array.from(new Set([
      ...billedItems.map(refOf).filter(Boolean),
      ...(m.invoice_number ? [m.invoice_number] : (m.invoice_odoo_id && !billedItems.length ? [`brouillon Odoo #${m.invoice_odoo_id}`] : autoFact ? ['auto-facturation'] : [])),
    ])) as string[]

    let amount = 0, note: string | null = null, nothing: string | null = null, days: number | null = null, amountUnknown = false
    let regimeEff = String(m.mission_type || 'autre')   // régime tarifaire réellement appliqué (saisie → autre après levée)
    const facts: { label: string; value: string }[] = []
    let title = '', subtitle = '', started: string | null = null, ended: string | null = null, open = false

    if (kind === 'gard') {
      const regime = String(m.mission_type || 'autre')
      const entry = ts(m.parked_at) || ts(m.received_at) || Date.now()
      // Remise au Domaine : la période à charge du Parquet s'arrête là, même si
      // la fiche gardiennage est encore ouverte (le véhicule reste au parc).
      const remiseTs = root.domaine_remise_date ? ts(`${String(root.domaine_remise_date).slice(0, 10)}T00:00:00Z`) : null
      const exitRaw = ts(m.parc_exit_at)
      const exit  = remiseTs && remiseTs > entry && (!exitRaw || remiseTs < exitRaw) ? remiseTs : exitRaw
      open = !exit
      // Nuits passées au parc (Olivier 08/09/2026) — plus de Math.ceil qui comptait le jour d'entrée.
      const rawDays = nightsBetween(entry, exit ?? Date.now())
      // Olivier 08/09/2026 : hors saisie (levée de saisie, période non couverte par
      // un état de frais), c'est le tarif « autre » du gardiennage qui s'applique.
      const endDayForCover = exit ? new Date(exit).toISOString().slice(0, 10) : null
      const coveredByEf = !!(parquet?.billed_to_date && endDayForCover && String(parquet.billed_to_date).slice(0, 10) >= endDayForCover)
      // Levée de saisie : le dossier Parquet clos, OU la levée posée sur la fiche
      // sans aucun état de frais parti (le dossier n'est pas encore clôturé —
      // il l'est à la levée depuis le 08/09, et par le cron du matin avant).
      // La levée coupe la période saisie MÊME en frais de justice : « si le
      // client vient rechercher la voiture après, il paie le gardiennage hors
      // saisie au tarif autres depuis le lendemain de la fin de saisie jusqu'à
      // la date où il vient le rechercher » (Olivier 09/09/2026). Ce qui reste
      // propre aux frais de justice, c'est le DÉPANNAGE, qui lui part en état
      // de frais (plus bas).
      const levee = !!parquet && parquet.recipient !== 'client'
        && (parquet.state === 'clos' || (!!(root.levee_saisie_at || root.levee_saisie_date) && root.levee_saisie_type !== 'temporaire' && !parquet.ef_number && !(parquet.efs || []).length))
      // Frais de justice (test à blanc du 09/09 après-midi) : la période SOUS saisie reste au
      // tarif saisie et part en état de frais ; seule la période ouverte après la levée
      // (mission_type « autre », créée par la levée) est au tarif « autre », à charge du client.
      // Olivier 10/09/2026 (WW734QC) : la période SOUS saisie reste au tarif saisie
      // (1,56 €), quel que soit le payeur ; seules les nuits APRÈS le jour de la levée
      // sont au tarif « autre » (20 €). Avant, une levée posée sans état de frais
      // basculait TOUT le volet à 20 € (28 nuits = 560 € au lieu de 43,68 €).
      // Normalement la levée coupe le volet et en ouvre un « autre » le lendemain ;
      // ce partage ne sert que si le volet n'a pas été coupé (levée du jour, ancien
      // dossier) — coveredByEf reste informatif.
      regimeEff = regime
      const tarif = dayPriceByRegime[regimeEff]
      let dayPrice = tarif?.price || 0
      if (!dayPrice && rootEst?.parc_jours > 0) dayPrice = r2(Number(rootEst.parc_eur) / Number(rootEst.parc_jours))
      days = Math.max(0, rawDays - (tarif?.free || 0))
      let split: { saisie: number; autre: number; autrePrice: number } | null = null
      if (regime === 'saisie' && levee && root.levee_saisie_date) {
        const cut = ts(`${String(root.levee_saisie_date).slice(0, 10)}T23:59:59Z`)!
        const endTs = exit ?? Date.now()
        if (endTs > cut) {
          const nightsSaisie = nightsBetween(entry, cut)
          const nightsAutre  = nightsBetween(cut, endTs)
          split = { saisie: nightsSaisie, autre: nightsAutre, autrePrice: dayPriceByRegime['autre']?.price || 0 }
          days = nightsSaisie + nightsAutre
        }
      }
      void coveredByEf
      // « Sans frais » depuis le dossier (motif) ≠ abandon volontaire : les deux mettent le gardiennage à zéro,
      // mais le libellé doit dire lequel (Olivier 08/09/2026, 2CLN087 « OK Momo »).
      if (m.no_charge_at) { amount = 0; nothing = `sans frais${m.no_charge_reason ? ' : ' + String(m.no_charge_reason) : ''}` }
      else if (m.storage_waived) { amount = 0; nothing = 'gardiennage offert (abandon volontaire)' }
      else if (Number(m.storage_flat_htva) > 0) { amount = r2(Number(m.storage_flat_htva)); note = 'forfait gardiennage' }
      else if (days <= 0 && !open) { amount = 0; nothing = `aucune nuit facturable (${rawDays} nuit${rawDays > 1 ? 's' : ''}${(tarif?.free || 0) > 0 ? `, ${tarif?.free} offerte${(tarif?.free || 0) > 1 ? 's' : ''}` : ''})` }
      else if (split) {
        amount = r2(split.saisie * dayPrice + split.autre * split.autrePrice)
        note = `${split.saisie} j × ${dayPrice.toFixed(2)} € (saisie)${split.autre ? ` + ${split.autre} j × ${split.autrePrice.toFixed(2)} € (hors saisie, après la levée)` : ''}`
      }
      else { amount = r2(days * dayPrice); note = dayPrice ? `${days} j × ${dayPrice.toFixed(2)} €` : `${days} j · tarif journalier introuvable` }
      title = 'Gardiennage'
      subtitle = [regimeEff !== regime ? `régime ${REGIME_LABEL[regime] || regime} → ${REGIME_LABEL[regimeEff] || regimeEff} (levée de saisie)` : `régime ${REGIME_LABEL[regime] || regime}`, m.parc_zone_key ? `zone ${m.parc_zone_key}` : null, m.parc_row_number != null ? `rangée ${m.parc_row_number}` : null].filter(Boolean).join(' · ')
      started = m.parked_at || m.received_at; ended = exit ? new Date(exit).toISOString() : null
      const originName = m.parc_origin_mission_id ? (legRows.find(x => x.id === m.parc_origin_mission_id)) : null
      facts.push({ label: 'Entrée', value: `${fmtD(started)}${originName?.assigned_to ? ' — ' + (nameById[originName.assigned_to] || '') : ''}` })
      facts.push({ label: 'Sortie', value: exit ? `${fmtD(m.parc_exit_at)} — ${({ relivraison: 'relivraison', sortie: 'sortie du parc', annulation: 'annulation', reparc: 'nouveau séjour', correction: 'correction', facturation: 'facturé, période suivante ouverte', levee_saisie: 'fin de saisie (levée)' } as any)[m.parc_exit_reason] || m.parc_exit_reason || ''}` : 'toujours au parc' })
      facts.push({ label: 'Durée', value: `${rawDays} jour${rawDays > 1 ? 's' : ''}${tarif?.free ? ` (${tarif.free} offert${tarif.free > 1 ? 's' : ''})` : ''}` })
      const KEY_LOC: Record<string, string> = { in_vehicle: 'dans le véhicule', reception: 'réception', digibox: 'digibox', office: 'bureau', hook: 'crochet' }
      if (m.key_location || m.keys_digibox_slot || m.saisie_key_hook) facts.push({ label: 'Clés', value: [m.key_location ? (KEY_LOC[m.key_location] || m.key_location) : null, m.keys_digibox_slot ? `digibox ${m.keys_digibox_slot}` : null, m.saisie_key_hook ? `crochet ${m.saisie_key_hook}` : null].filter(Boolean).join(' · ') })
      if (m.redelivery_address) facts.push({ label: 'Relivraison', value: `${m.redelivery_address}${m.garage_reopen_date ? ` · réouverture ${m.garage_reopen_date}` : ''}` })
      if (root.requisitoire_at && regime !== 'assistance') facts.push({ label: 'Réquisitoire', value: `reçu le ${fmtD(root.requisitoire_at)}${root.requisitoire_reminder_count ? ` · ${root.requisitoire_reminder_count} relance(s)` : ''}` })
      else if (regime === 'saisie' || String(root.source || '').startsWith('police_')) facts.push({ label: 'Réquisitoire', value: root.requisitoire_reminder_count ? `attendu · ${root.requisitoire_reminder_count} relance(s)` : 'attendu' })
      if (root.levee_saisie_date) facts.push({ label: 'Levée de saisie', value: String(root.levee_saisie_date) })
      if (root.domaine_remise_date) facts.push({ label: 'Domaine', value: `remis le ${root.domaine_remise_date}${root.domaine_enlevement_date ? ` · enlevé le ${root.domaine_enlevement_date}` : ''}` })
      facts.push({ label: 'Photos / remarques', value: `héritées de A${m.remarks_general && m.remarks_general !== root.remarks_general ? ' · + ' + m.remarks_general : ''}` })
    } else {
      // Action réelle (REM / DSP / REL…) : estimation du moteur, hors gardiennage
      // (le gardiennage a ses propres groupes).
      // Montant = EXACTEMENT les lignes que la facturation poussera dans Odoo
      // (brouillon > montants forcés > moteur Siabis > estimation), gardiennage
      // exclu quand le dossier a ses groupes gardiennage. L'estimation générale
      // ne sert plus qu'aux km affichés.
      const est: any = pre.get(m.id)?.est ?? null
      if (!priced) {
        if (Number(m.special_tarif_htva) > 0) { amount = r2(Number(m.special_tarif_htva)); note = 'prix convenu' }
        else { amount = r2(Number(m.estimated_htva) || 0); note = Number(m.estimated_htva) > 0 ? 'estimation figée' : 'estimation à calculer'; if (!(Number(m.estimated_htva) > 0)) amountUnknown = true }
      } else {
        const built: { lines: any[]; has_tariff: boolean; reason?: string; failed?: boolean } = pre.get(m.id)?.built || { lines: [], has_tariff: false }
        if (built.has_tariff && built.lines.length) {
          amount = linesTotal(built.lines)
          note = built.lines.map(l => `${l.name.replace(/\s+—.*$/, '').slice(0, 40)}${l.qty !== 1 ? ` ×${l.qty}` : ''} ${Number(l.qty * l.price_unit).toFixed(2)} €`).join(' · ')
        } else if (built.failed) {
          // Le moteur n'a pas répondu (exception). On ne prétend pas que la
          // fiche est incalculable — on montre le dernier montant figé quand il
          // existe, en disant d'où il vient. Olivier 09/09/2026 : 2CMX015 est
          // sorti au bon tarif en facturation auto alors que la liste le
          // donnait « à calculer ».
          const fige = Number(m.special_tarif_htva) > 0 ? Number(m.special_tarif_htva) : Number(m.estimated_htva) || 0
          if (fige > 0) { amount = r2(fige); note = `calcul indisponible — montant figé (${built.reason || 'erreur du moteur'})` }
          else { amount = 0; amountUnknown = true; note = `calcul indisponible : ${built.reason || 'erreur du moteur'}` }
        } else if (billedRefs.length) {
          // Rien à calculer parce que tout est DÉJÀ réglé (facture partielle du
          // module classique, n° d'accord, auto-facturation) : les postes ont été
          // déduits (D2) et il ne reste rien — ce n'est pas « à calculer ».
          // HSAV6087 et 1HVS176, 09/09/2026.
          amount = billedHtva; amountUnknown = false; note = billedHtva > 0 ? 'postes déjà facturés' : `déjà réglé (${billedRefs[0]})`
        } else {
          // Pas de tarif calculable : on le DIT (montant inconnu), on ne
          // ressort pas une estimation figée par l'ancien calcul (2AVA116 :
          // 89,51 € figés alors que les km étaient inconnus).
          amount = 0; amountUnknown = true; note = built.reason || est?.reason || 'tarif introuvable'
        }
      }
      if (kind === 'rel' && amount === 0 && (m.status === 'cancelled')) nothing = 'annulée'
      if (kind === 'rel' && m.parked_at && ts(m.parked_at)! > (ts(m.loaded_at) || 0) && !m.completed_at) nothing = nothing || null

      title = getMissionTypeLabel(m.mission_type, 'long')
      subtitle = [m.dossier_number || m.external_id || null].filter(Boolean).join(' · ')
      started = m.received_at || m.intervention_date; ended = m.completed_at || m.cancelled_at || null
      open = !ended && !DEAD.has(m.status)
      if (m.assigned_to) facts.push({ label: 'Chauffeur', value: nameById[m.assigned_to] || '—' })
      const times = [m.on_way_at ? `en route ${fmtD(m.on_way_at)}` : null, m.on_site_at ? `sur place ${fmtD(m.on_site_at)}` : null, m.loaded_at ? `chargé ${fmtD(m.loaded_at)}` : null, m.completed_at ? `clôturé ${fmtD(m.completed_at)}` : null].filter(Boolean)
      if (times.length) facts.push({ label: 'Pointages', value: times.join(' · ') })
      if (m.incident_address) facts.push({ label: kind === 'rel' ? 'Départ' : 'Intervention', value: m.incident_address })
      if (m.destination_address) facts.push({ label: kind === 'rel' ? 'Livré à' : 'Destination', value: `${m.destination_name ? m.destination_name + ' · ' : ''}${m.destination_address}` })
      if (est?.ok && est.km_charged) facts.push({ label: 'Km', value: `${est.km_charged} km${est.km_inclus ? ` · ${est.km_inclus} inclus` : ''}${est.km_extra ? ` · ${est.km_extra} additionnels` : ''}` })
      if (m.client_signature) facts.push({ label: 'Signature', value: `✓ ${m.client_signature_name || 'client'}` })
      if (Array.isArray(m.driver_photos) && m.driver_photos.length) facts.push({ label: 'Photos', value: `${m.driver_photos.length} photo${m.driver_photos.length > 1 ? 's' : ''}` })
      if (m.closing_notes) facts.push({ label: 'Remarque clôture', value: m.closing_notes })
      {
        const adv = (pre.get(m.id)?.built?.lines || []).filter((l: any) => /^Avance de fonds/i.test(l.name))
        if (adv.length) facts.push({ label: 'Avances de fonds', value: `${adv.length} · ${r2(adv.reduce((t: number, l: any) => t + l.qty * l.price_unit, 0)).toFixed(2)} € HTVA, ajoutée${adv.length > 1 ? 's' : ''} à la facture` })
      }
      if (m.cancelled_reason) facts.push({ label: 'Motif', value: m.cancelled_reason })
    }

    legs.push({
      letter: '', kind, mission_id: m.id, mission_number: m.mission_number, external_id: m.external_id,
      dossier_number: m.dossier_number || null, title, subtitle, status: m.status,
      // Gardiennage réglé sans facture (0 nuit facturable, sans frais, offert) : plus « à facturer » (Olivier 08/09/2026).
      status_label: (kind === 'gard' && nothing && !open && !m.invoice_number) ? (nothing.startsWith('aucune nuit') ? 'Rien à facturer · 0 nuit' : nothing.startsWith('sans frais') ? 'Sans frais' : 'Offert')
        : (kind !== 'gard' && !open && !nothing && !amountUnknown && amount === 0 && !billedRefs.length && m.status === 'to_invoice') ? 'Rien à facturer · 0 €'
        : (amountUnknown && billedRefs.length && !billedItems.length) ? 'Facture sans ligne · à vérifier' : st.label,
      status_tone: ((kind === 'gard' && nothing && !open && !m.invoice_number) || (kind !== 'gard' && !open && !nothing && !amountUnknown && amount === 0 && !billedRefs.length && m.status === 'to_invoice')) ? 'ok' : (amountUnknown && billedRefs.length && !billedItems.length) ? 'warn' : st.tone, started_at: started, ended_at: ended, open,
      driver_name: m.assigned_to ? (nameById[m.assigned_to] || null) : null,
      billed_to_id: payer(m).id, billed_to_name: payer(m).name,
      billed_inherited: payer(m).id === payer(root).id,
      // Groupe marqué « déjà facturé » alors que son montant n'était pas encore
      // calculé (ligne à 0 €) : il est réglé, on ne ressort pas un « reste à
      // facturer » quand le tarif arrive après coup (2GSE264, 08/09/2026).
      facts, amount_htva: amount, amount_note: note,
      billed_htva: billedHtva || ((billedRefs.length && (!billedItems.length || (!!m.invoice_number && billedItems.every(it => !Number(it.amount_htva)))) && !amountUnknown) ? amount : 0),   // D9 : un groupe sans tarif n'est jamais « facturé » par une facture sans ligne
      billed_refs: billedRefs, nothing_to_bill: nothing, days, regime: kind === 'gard' ? String(m.mission_type || 'autre') : null, free_days: kind === 'gard' ? (dayPriceByRegime[regimeEff]?.free || 0) : undefined, redelivery_address: (kind === 'gard' ? root.redelivery_address : m.redelivery_address) || null, amount_unknown: amountUnknown || undefined,
      // Olivier 07/09/2026 : « tout ce qui est modifiable doit l'être dans la vue 2 ».
      editable: kind === 'gard' ? undefined : {
        client_name: m.client_name || null, client_phone: m.client_phone || null, client_address: m.client_address || null,
        assisted_name: m.assisted_name || null, assisted_phone: m.assisted_phone || null,
        vehicle_plate: m.vehicle_plate || null, vehicle_brand: m.vehicle_brand || null, vehicle_model: m.vehicle_model || null, vehicle_vin: m.vehicle_vin || null,
        vehicle_fuel: m.vehicle_fuel || null, vehicle_gearbox: m.vehicle_gearbox || null, vehicle_mileage: m.vehicle_mileage != null ? String(m.vehicle_mileage) : null,
        incident_address: m.incident_address || null, destination_address: m.destination_address || null, destination_name: m.destination_name || null, redelivery_address: m.redelivery_address || null,
        incident_has_coords: m.incident_lat != null && m.incident_lng != null, destination_has_coords: m.destination_lat != null && m.destination_lng != null, redelivery_has_coords: m.redelivery_lat != null && m.redelivery_lng != null,
        mission_type: m.mission_type || null, source: m.source || null, dossier_number: m.dossier_number || null, intervention_date: m.intervention_date || null,
        incident_type: m.incident_type || null, incident_description: m.incident_description || null, remarks_general: m.remarks_general || null,
      },
      billing_remarks: [
        ...((Array.isArray(m.billing_remarks) ? m.billing_remarks : []).map((r: any) => ({ text: String(r.text || ''), author: r.author_name || null, at: r.created_at || null }))),
        ...(m.remarks_billing && !(Array.isArray(m.billing_remarks) && m.billing_remarks.some((r: any) => r.text === m.remarks_billing)) ? [{ text: String(m.remarks_billing), author: null, at: null }] : []),
      ].filter(r => r.text.trim()),
      payments: (payBy[m.id] || []).map((pz: any) => ({ amount: r2(Number(pz.amount || 0)), mode: pz.payment_mode || null, at: pz.created_at || null, driver: pz.driver_id ? (nameById[pz.driver_id] || null) : null })),
      alerts: (() => { const a: string[] = []; if (kind === 'gard') return a
        const paid = (payBy[m.id] || []).reduce((t: number, pz: any) => t + Number(pz.amount || 0), 0)
        if (Number(m.amount_to_collect) <= 0 && m.amount_to_collect_manual) a.push(`Montant mis à 0 sur place par le chauffeur (estimation ${amount.toFixed(2)} € HTVA)`)
        if (paid > 0 && amount > 0 && Math.abs(paid - amount * 1.21) >= 0.5) a.push(`Écart : ${paid.toFixed(2)} € encaissés sur place vs ${(amount * 1.21).toFixed(2)} € TVAC à facturer`)
        if ((payBy[m.id] || []).length > 1) a.push(`${(payBy[m.id] || []).length} paiements encaissés : à encoder dans Odoo`)
        if (m.needs_siabis_decision) a.push('Siabis autoroute : couvert / non couvert pas encore tranché')
        return a })(),
      _sort: startKey(m, kind), _rank: kind === 'rem' ? 0 : kind === 'gard' ? 1 : 2,
    } as any)
  }
  // ── Canal PARQUET : remorquage + gardiennages saisie facturés par état de
  //    frais (module Saisie), jamais par une facture Odoo du dossier.
  // Levée de saisie (dossier Saisie « clos ») : le Parquet ne paie plus rien
  // au-delà de ce qu'il a déjà couvert ; le véhicule est récupéré par le
  // client → ce qui reste se facture au client par Odoo (Olivier 08/09/2026,
  // 2CLN087 : « la récupération a été faite par le client »).
  const levee = !!parquet && (parquet.state === 'clos'
    || (!!(root.levee_saisie_at || root.levee_saisie_date) && root.levee_saisie_type !== 'temporaire' && !parquet.ef_number && !(parquet.efs || []).length))
  if (parquet && parquet.recipient !== 'client') {
    const efDep = parquet.efs.find(e => e.include_depannage)
    const lastEf = parquet.efs.length ? parquet.efs[parquet.efs.length - 1] : null
    for (const l of legs as any[]) {
      if (l.kind === 'rem' && l.mission_id === root.id) {
        // Frais de justice : le dépannage part en état de frais, levée ou pas.
        if (levee && !isFraisDeJustice && !efDep && !parquet.depannage_billed) continue   // rien envoyé au Parquet → client
        l.channel = 'parquet'
        // Les postes « client uniquement » (frais administratifs) ne vont pas
        // au Parquet : on les retire de l'affichage de ce groupe.
        if (typeof l.amount_note === 'string' && /client uniquement/i.test(l.amount_note)) {
          const parts = String(l.amount_note).split(' · ').filter((x: string) => !/client uniquement/i.test(x))
          const kept = parts.reduce((t: number, x: string) => t + (Number((x.match(/([0-9]+(?:\.[0-9]+)?) €$/) || [])[1]) || 0), 0)
          l.amount_note = parts.join(' · '); l.amount_htva = r2(kept)
        }
        const ef = efDep || lastEf
        if (parquet.depannage_billed || efDep) {
          l.billed_refs = [`EF n°${ef?.numero ?? parquet.ef_number ?? '?'}`]; l.billed_htva = l.amount_htva
          l.status_label = `État de frais n°${ef?.numero ?? ''} · ${EF_STATUS[String(ef?.status || '')] || ef?.status || 'envoyé'}`; l.status_tone = ef?.status === 'refuse' ? 'bad' : 'ok'
        } else { l.status_label = 'À mettre dans l’état de frais Parquet'; l.status_tone = 'warn' }
        if (!l.billed_to_name) { l.billed_to_name = 'Parquet de Verviers — frais de justice'; l.billed_inherited = false }
      }
      if (l.kind === 'gard' && l.regime === 'saisie') {
        const endDay = l.ended_at ? String(l.ended_at).slice(0, 10) : null
        const covered = !!(parquet.billed_to_date && endDay && String(parquet.billed_to_date).slice(0, 10) >= endDay)
        if (levee && !covered && !isFraisDeJustice) {   // levée de saisie, période non couverte par un état de frais → client (Odoo) — sauf frais de justice : état de frais
          l.channel = 'odoo'
          // Déjà réglé (facturé, sans frais, offert) : on garde son état, on ne le réécrit pas.
          if (!l.nothing_to_bill && !l.billed_refs.length) {
            l.status_label = `${l.open ? 'Gardiennage en cours' : 'Terminé'} · à facturer au client (levée de saisie${root.levee_saisie_date ? ' du ' + String(root.levee_saisie_date).slice(8, 10) + '/' + String(root.levee_saisie_date).slice(5, 7) : ''})`
            l.status_tone = 'warn'
          }
          continue
        }
        l.channel = 'parquet'
        const ef = lastEf
        if (covered && ef) { l.billed_refs = [`EF n°${ef.numero ?? ''}`]; l.billed_htva = l.amount_htva; l.status_label = `État de frais n°${ef.numero ?? ''} · ${EF_STATUS[String(ef.status || '')] || ef.status}`; l.status_tone = ef.status === 'refuse' ? 'bad' : 'ok' }
        else if (parquet.billed_to_date) { l.status_label = `${l.open ? 'Gardiennage en cours' : 'Terminé'} · Parquet facturé jusqu'au ${String(parquet.billed_to_date).slice(0, 10)}` }
        else { l.status_label = `${l.open ? 'Gardiennage en cours' : 'Terminé'} · état de frais à venir` }
        if (!l.billed_to_name) { l.billed_to_name = 'Parquet de Verviers — frais de justice'; l.billed_inherited = false }
      }
    }
  }

  // ── Groupe DOMAINE (saisies) : remise → enlèvement, à charge du SPF Finances ─
  // Même règle que le relevé trimestriel (lib/fourriere/domaine-billing) :
  // jours = remise → enlèvement inclus, tarif SERV-PARC saisie (voiture/cyclo).
  if (root.domaine_remise_date) {
    const remise = String(root.domaine_remise_date).slice(0, 10)
    const enlev  = root.domaine_enlevement_date ? String(root.domaine_enlevement_date).slice(0, 10) : null
    const cyclo  = /moto|cyclo/i.test(String(root.vehicle_class || ''))
    const { data: rl } = await sb.from('source_tariff_lines').select('name, default_price, effective_from, effective_to')
      .eq('source', 'police_saisie').eq('kind', 'SERV-PARC')
    const year = remise.slice(0, 4)
    const rate = (rl || []).filter((l: any) => /gardiennage \(par jour\)/i.test(l.name) && !/hors période/i.test(l.name) && (/cyclo/i.test(l.name) === cyclo) && (!l.effective_from || l.effective_from <= `${year}-06-01`) && (!l.effective_to || l.effective_to >= `${year}-06-01`))
      .map((l: any) => Number(l.default_price))[0] ?? 0
    const dDays = enlev ? Math.max(0, Math.round((ts(`${enlev}T00:00:00Z`)! - ts(`${remise}T00:00:00Z`)!) / DAY_MS)) : Math.max(0, Math.floor((Date.now() - ts(`${remise}T00:00:00Z`)!) / DAY_MS))
    const dAmount = r2(dDays * rate)
    const { data: vente } = await sb.from('domaine_ventes_epaves').select('firm, vente_date, numero, sortie_reelle_date, date_out').eq('matched_mission_id', root.id).order('received_at', { ascending: false }).limit(1).maybeSingle()
    const dFacts: { label: string; value: string }[] = [
      { label: 'Remise', value: `${remise}${root.domaine_note ? ' · ' + root.domaine_note : ''}` },
      { label: 'Enlèvement', value: enlev ? enlev : 'attendu' },
      { label: 'Vente', value: root.domaine_vente_date ? `${String(root.domaine_vente_date).slice(0, 10)}${root.domaine_vente_firm ? ' · ' + root.domaine_vente_firm : ''}${(vente as any)?.numero ? ' · n° ' + (vente as any).numero : ''}` : ((vente as any)?.vente_date ? `${(vente as any).vente_date} · ${(vente as any).firm || ''}` : 'pas encore de lot') },
      { label: 'Gardiennage État', value: rate ? `${dDays} j × ${rate.toFixed(2)} € = ${dAmount.toFixed(2)} € HTVA${enlev ? '' : ' à ce jour'}` : `${dDays} j · tarif saisie introuvable` },
      { label: 'Facturation', value: 'relevé trimestriel Domaine (module Fourrière → Domaine), pas de facture Odoo par dossier' },
    ]
    legs.push({
      letter: '', kind: 'out', mission_id: root.id + ':domaine', mission_number: root.mission_number, external_id: null,
      dossier_number: root.dossier_number || null, title: 'Domaine', subtitle: `SPF Finances · remise du ${remise}`,
      status: enlev ? 'completed' : 'parked', status_label: enlev ? (root.domaine_vente_date ? 'Vendu · relevé Domaine' : 'Enlevé · relevé Domaine') : 'Au parc pour le Domaine',
      status_tone: enlev ? 'ok' : 'live', started_at: `${remise}T00:00:00Z`, ended_at: enlev ? `${enlev}T00:00:00Z` : null, open: !enlev,
      driver_name: null, billed_to_id: null, billed_to_name: 'SPF Finances — Domaine', billed_inherited: false,
      facts: dFacts, amount_htva: dAmount, amount_note: rate ? `${dDays} j × ${rate.toFixed(2)} €` : null, billed_htva: 0, billed_refs: [],
      nothing_to_bill: null, days: dDays, regime: 'saisie', channel: 'domaine', billing_remarks: [], payments: [],
      _sort: ts(`${remise}T00:00:00Z`), _rank: 3,
    } as any)
  }

  // ── Groupe SORTIE : restitution / sans frais / épave détruite ─────────────
  const { data: outLogs } = await sb.from('mission_logs').select('mission_id, action, notes, created_at, actor_id, metadata')
    .in('mission_id', ids).in('action', ['restituted_invoice', 'restituted_driver_cash', 'no_charge', 'levee_saisie'])
    .order('created_at', { ascending: true })
  const outActors = Array.from(new Set((outLogs || []).map((l: any) => l.actor_id).filter(Boolean)))
  if (outActors.length) {
    const { data: us3 } = await sb.from('users').select('id, name').in('id', outActors.filter(a => !nameById[a]))
    for (const u of us3 || []) nameById[(u as any).id] = (u as any).name
  }
  const sortie = (outLogs || []).find((l: any) => l.action !== 'levee_saisie')
  if (sortie || root.scratched_at) {
    const l: any = sortie
    const mode = l?.action === 'restituted_invoice' ? 'Restitution facturée' : l?.action === 'restituted_driver_cash' ? 'Restitution encaissée' : l?.action === 'no_charge' ? 'Restitution sans frais' : 'Destruction (épave)'
    const at = l?.created_at || root.scratched_at
    const paysAll = ids.flatMap(id => payBy[id] || [])
    const oFacts: { label: string; value: string }[] = [
      { label: 'Sortie', value: `${fmtD(at)}${l?.actor_id ? ' — ' + (nameById[l.actor_id] || '') : ''}` },
      ...(l?.notes ? [{ label: 'Détail', value: String(l.notes).slice(0, 200) }] : []),
      ...(root.no_charge_reason ? [{ label: 'Motif', value: String(root.no_charge_reason) }] : []),
      ...(paysAll.length ? [{ label: 'Encaissé', value: paysAll.map((pz: any) => `${r2(Number(pz.amount || 0)).toFixed(2)} €${pz.payment_mode ? ' (' + pz.payment_mode + ')' : ''}`).join(' · ') }] : []),
    ]
    legs.push({
      letter: '', kind: 'out', mission_id: root.id + ':sortie', mission_number: root.mission_number, external_id: null,
      dossier_number: root.dossier_number || null, title: mode, subtitle: root.billed_to_name || '',
      status: 'completed', status_label: l?.action === 'restituted_invoice' ? 'Facturée avec le remorquage' : l?.action === 'restituted_driver_cash' ? 'Encaissée' : l?.action === 'no_charge' ? 'Sans frais' : 'Épave',
      status_tone: 'ok', started_at: at, ended_at: at, open: false, driver_name: null,
      billed_to_id: root.billed_to_id ?? null, billed_to_name: root.billed_to_name ?? null, billed_inherited: true,
      facts: oFacts, amount_htva: 0, amount_note: null, billed_htva: 0, billed_refs: [],
      nothing_to_bill: l?.action === 'restituted_invoice' ? 'réglé par la facture du remorquage' : l?.action === 'restituted_driver_cash' ? 'réglé à la restitution' : l?.action === 'no_charge' ? 'sans frais' : 'épave détruite',
      days: null, regime: null, channel: 'odoo', billing_remarks: [], payments: [],
      _sort: ts(at) || Date.now(), _rank: 4,
    } as any)
  }
  // Levées de saisie : lignes fines dans la chronologie.
  for (const l of (outLogs || []).filter((x: any) => x.action === 'levee_saisie')) {
    eventRows.push({ _plain: true, id: l.mission_id, received_at: l.created_at, source: root.source, status: 'levee', mission_type: null, _label: String(l.notes || 'Levée de saisie').replace(/^🔓\s*/, '') })
  }

  legs.sort((a: any, b: any) => (a._sort - b._sort) || (a._rank - b._rank))
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  // D4 : une lettre figée à la première apparition (colonne dossier_letter) ; les
  // nouveaux groupes prennent les lettres libres suivantes dans l'ordre. Les
  // pseudo-groupes (Domaine, Sortie) ne se figent pas.
  const storedById = new Map<string, string>(legRows.filter(r => r.dossier_letter).map(r => [r.id, String(r.dossier_letter)]))
  const used = new Set<string>(storedById.values())
  let next = 0
  const toPersist: { id: string; letter: string }[] = []
  legs.forEach((l: any) => {
    const stored = l.kind !== 'out' ? storedById.get(l.mission_id) : undefined
    if (stored) { l.letter = stored }
    else { while (used.has(LETTERS[next] || String(next + 1))) next++; l.letter = LETTERS[next] || String(next + 1); used.add(l.letter); next++
      if (l.kind !== 'out' && legRows.some(r => r.id === l.mission_id)) toPersist.push({ id: l.mission_id, letter: l.letter }) }
    delete l._sort; delete l._rank
  })
  if (toPersist.length && !light) for (const t of toPersist) sb.from('incoming_missions').update({ dossier_letter: t.letter }).eq('id', t.id).is('dossier_letter', null).then(() => {}, () => {})

  // ── Événements (mails sans action) ───────────────────────────────────────
  const events: DossierEvent[] = eventRows.map((e: any): DossierEvent => ({
    at: e.received_at, mission_id: e.id, source: e.source,
    label: e._plain ? e._label : e._other
      ? `Autre dossier #${e.mission_number ?? '?'} pour la même plaque — ${getMissionTypeLabel(e.mission_type, 'long')} ${sourceLabel(e.source)}, ${statusOf(e, 'rem').label.toLowerCase()}`
      : e._orphan
      ? (e._verify ? `Mail ${sourceLabel(e.source)} pour la même plaque, autre n° de dossier (${e.dossier_number}) — à vérifier` : `Mail ${sourceLabel(e.source)} reçu, sans action (${statusOf(e, 'rem').label.toLowerCase()})`)
      : `${getMissionTypeLabel(e.mission_type, 'long')} ${sourceLabel(e.source)} — ${statusOf(e, 'rem').label.toLowerCase()}`,
    detail: e._other ? null : (e.cancelled_reason || e.closing_notes || null),
    kind: (e._plain ? 'ignored' : e._other ? 'autre_dossier' : e._orphan ? (e._verify ? 'a_verifier' : 'orphan') : (e.status === 'cancelled' ? 'cancelled' : 'ignored')) as DossierEvent['kind'],
    mission_number: e.mission_number ?? null, status: e.status,
  })).sort((a, b) => (ts(a.at) || 0) - (ts(b.at) || 0))

  // ── Totaux + factures ────────────────────────────────────────────────────
  const estimated = r2(legs.reduce((s, l) => s + l.amount_htva, 0))
  const billed    = r2(legs.reduce((s, l) => s + l.billed_htva, 0))
  // Encaissé = encaissements chauffeur (interventions) ; repli sur le montant
  // payé porté par la fiche quand il n'y a pas d'encaissement enregistré.
  const collected = r2(legRows.reduce((s, m) => {
    const enc = (payBy[m.id] || []).reduce((t: number, pz: any) => t + Number(pz.amount || 0), 0)
    return s + (enc > 0 ? enc : Number(m.payment_amount || m.amount_collected || 0))
  }, 0))
  const invMap: Record<string, { number: string; covers: Set<string>; client: string | null; amount: number; at: string | null; url: string | null }> = {}
  for (const l of legs) {
    const m = legRows.find(x => x.id === l.mission_id)
    for (const it of itemsBy[l.mission_id] || []) {
      const ref = refOf(it); if (!ref) continue
      const e = (invMap[ref] ||= { number: ref, covers: new Set(), client: it.billed_to_name || null, amount: 0, at: it.billed_at || null, url: it.invoice_odoo_id ? draftUrl(it.invoice_odoo_id) : null })
      e.covers.add(l.letter); e.amount = r2(e.amount + Number(it.amount_htva || 0))
    }
    const items0 = itemsBy[l.mission_id] || []
    if (m?.invoice_number && !items0.some((it: any) => it.invoice_number === m.invoice_number)) {
      const e = (invMap[m.invoice_number] ||= { number: m.invoice_number, covers: new Set(), client: m.billed_to_name || null, amount: 0, at: m.invoiced_at || null, url: m.invoice_url || (m.invoice_odoo_id ? draftUrl(m.invoice_odoo_id) : null) })
      e.covers.add(l.letter); e.amount = r2(e.amount + l.amount_htva); if (!e.url && m.invoice_url) e.url = m.invoice_url
    } else if (!m?.invoice_number && m?.invoice_odoo_id && !items0.length) {
      const ref = `brouillon Odoo #${m.invoice_odoo_id}`
      const e = (invMap[ref] ||= { number: ref, covers: new Set(), client: m.billed_to_name || null, amount: 0, at: m.invoice_created_at || null, url: draftUrl(m.invoice_odoo_id) })
      e.covers.add(l.letter); e.amount = r2(e.amount + l.amount_htva)
    }
  }

  const domaineOpen = legs.find(l => l.kind === 'out' && l.channel === 'domaine' && l.open)
  const openLeg = legs.find(l => l.kind === 'gard' && l.open) || domaineOpen
  const relPending = legs.find(l => l.kind === 'rel' && l.open)
  const state = openLeg ? { open: true, reason: `véhicule au parc${openLeg.subtitle ? ' · ' + openLeg.subtitle.replace(/^régime [^·]+ · /, '') : ''}` }
    : relPending ? { open: true, reason: 'relivraison en cours' }
    : legs.some(l => l.open) ? { open: true, reason: 'intervention en cours' }
    : { open: false, reason: null }
  const lastGard = [...legs].reverse().find(l => l.kind === 'gard')
  const lastGardRow = lastGard ? legRows.find(r => r.id === lastGard.mission_id) : null
  const last_parc = lastGard ? { zone: lastGardRow?.parc_zone_key || root.parc_zone_key || null, entered_at: lastGard.started_at, exited_at: lastGard.ended_at, reason: lastGardRow?.parc_exit_reason || null, letter: lastGard.letter } : null

  return {
    last_parc,
    root_id: root.id,
    ref: root.mission_number != null ? `#${root.mission_number}` : (root.dossier_number || root.external_id || root.id.slice(0, 8)),
    number: root.mission_number ?? null,
    dossier_number: root.dossier_number || null,
    source: root.source, source_label: sourceLabel(root.source),
    vehicle: { plate: root.vehicle_plate, brand: root.vehicle_brand, model: root.vehicle_model, vin: root.vehicle_vin },
    client: { name: root.client_name, phone: root.client_phone },
    billed_to: payer(root),
    received_at: root.received_at,
    // `light` signale au client « montants figés, recalcule en fond » : un
    // dossier tarifé n'en est pas un, même construit avec les raccourcis.
    state, legs, events, light: (light && !priced) || undefined,
    parquet,
    stamps: {
      domaine: root.domaine_vente_date ? `Vendu au Domaine${root.domaine_vente_firm ? ' · ' + root.domaine_vente_firm : ''}` : (root.domaine_remise_date ? `Remis au Domaine le ${String(root.domaine_remise_date).slice(0, 10)}` : null),
      touring_check: root.touring_check_stamp || null,
    },
    totals: { estimated, billed, collected, remaining: r2(Math.max(0, estimated - billed)), due_tvac: r2(Math.max(0, estimated * 1.21 - collected)) },   // D13 : collected est TVAC (encaissé sur place)
    invoices: Object.values(invMap).map(e => ({ ...e, covers: Array.from(e.covers).sort() })),
  }
}

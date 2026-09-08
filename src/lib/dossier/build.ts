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
  // Adresse de relivraison : portée par la mise en parc (Olivier 07/09 : « c'est la
  // mise en parc qui contient les infos de relivraison ») — lue sur la racine.
  redelivery_address: string | null
  // Mode léger : pas de montant figé sur la fiche → à calculer (moteur de prix).
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
  totals:         { estimated: number; billed: number; collected: number; remaining: number }
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

// `light` : pour les LISTES — pas de moteur de prix (routage), on prend le
// montant figé de la fiche (special_tarif_htva / estimated_htva) ; pas de
// recherche d'orphelins par plaque.
export async function buildDossier(anyMissionId: string, opts: { light?: boolean } = {}): Promise<Dossier | null> {
  const light = !!opts.light
  const sb = createAdminClient()

  const { data: m0, error: e0 } = await sb.from('incoming_missions').select('*').eq('id', anyMissionId).maybeSingle()
  if (e0) console.error('[dossier/build]', e0.message)
  if (!m0) return null
  let root: any = m0
  if ((m0 as any).parent_mission_id) {
    const { data: p } = await sb.from('incoming_missions').select('*').eq('id', (m0 as any).parent_mission_id).maybeSingle()
    if (p) root = p
  }

  const { data: kidsRaw } = await sb.from('incoming_missions').select('*')
    .eq('parent_mission_id', root.id).order('received_at', { ascending: true })
  const kids: any[] = kidsRaw || []

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
  if (!light) {
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
    .select('mission_id, kind, label, amount_htva, invoice_number, billed_to_name, billed_at, odoo_quote_id, invoice_odoo_id, dossier_letter')
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
  const refOf = (it: any) => it.invoice_number || (it.invoice_odoo_id ? `brouillon Odoo #${it.invoice_odoo_id}` : null)
  const ODOO_URL = process.env.ODOO_URL || ''
  const draftUrl = (id: number) => ODOO_URL ? `${ODOO_URL}/web#id=${id}&model=account.move&view_type=form` : null
  const itemsBy: Record<string, any[]> = {}
  for (const it of items || []) (itemsBy[(it as any).mission_id] ||= []).push(it)

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
  const pre = new Map<string, { est: any; built: { lines: any[]; has_tariff: boolean; reason?: string } | null }>()
  await Promise.all(legRows.map(async (m) => {
    if (kindOf(m) === 'gard' || light) { pre.set(m.id, { est: null, built: null }); return }
    const [est, built] = await Promise.all([
      (m.id === root.id && rootEst) ? Promise.resolve(rootEst) : estimateMissionPrice(m).catch(() => null),
      actionLines(m, draftsBy[m.id], legRows.some(r => r.dossier_leg)).catch((e: any) => ({ lines: [], has_tariff: false, reason: e?.message })),
    ])
    pre.set(m.id, { est, built })
  }))

  rootEst = pre.get(root.id)?.est ?? null

  // ── Construction des groupes ─────────────────────────────────────────────
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
      const tarif = dayPriceByRegime[regime]
      let dayPrice = tarif?.price || 0
      if (!dayPrice && rootEst?.parc_jours > 0) dayPrice = r2(Number(rootEst.parc_eur) / Number(rootEst.parc_jours))
      days = Math.max(0, rawDays - (tarif?.free || 0))
      if (m.storage_waived) { amount = 0; nothing = 'gardiennage offert (abandon volontaire)' }
      else if (Number(m.storage_flat_htva) > 0) { amount = r2(Number(m.storage_flat_htva)); note = 'forfait gardiennage' }
      else { amount = r2(days * dayPrice); note = dayPrice ? `${days} j × ${dayPrice.toFixed(2)} €` : `${days} j · tarif journalier introuvable` }
      title = 'Gardiennage'
      subtitle = [`régime ${REGIME_LABEL[regime] || regime}`, m.parc_zone_key ? `zone ${m.parc_zone_key}` : null, m.parc_row_number != null ? `rangée ${m.parc_row_number}` : null].filter(Boolean).join(' · ')
      started = m.parked_at || m.received_at; ended = exit ? new Date(exit).toISOString() : null
      const originName = m.parc_origin_mission_id ? (legRows.find(x => x.id === m.parc_origin_mission_id)) : null
      facts.push({ label: 'Entrée', value: `${fmtD(started)}${originName?.assigned_to ? ' — ' + (nameById[originName.assigned_to] || '') : ''}` })
      facts.push({ label: 'Sortie', value: exit ? `${fmtD(m.parc_exit_at)} — ${({ relivraison: 'relivraison', sortie: 'sortie du parc', annulation: 'annulation', reparc: 'nouveau séjour', correction: 'correction' } as any)[m.parc_exit_reason] || m.parc_exit_reason || ''}` : 'toujours au parc' })
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
      if (light) {
        if (Number(m.special_tarif_htva) > 0) { amount = r2(Number(m.special_tarif_htva)); note = 'prix convenu' }
        else { amount = r2(Number(m.estimated_htva) || 0); note = Number(m.estimated_htva) > 0 ? 'estimation figée' : 'estimation à calculer'; if (!(Number(m.estimated_htva) > 0)) amountUnknown = true }
      } else {
        const built: { lines: any[]; has_tariff: boolean; reason?: string } = pre.get(m.id)?.built || { lines: [], has_tariff: false }
        if (built.has_tariff && built.lines.length) {
          amount = linesTotal(built.lines)
          note = built.lines.map(l => `${l.name.replace(/\s+—.*$/, '').slice(0, 40)}${l.qty !== 1 ? ` ×${l.qty}` : ''} ${Number(l.qty * l.price_unit).toFixed(2)} €`).join(' · ')
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
      status_label: st.label, status_tone: st.tone, started_at: started, ended_at: ended, open,
      driver_name: m.assigned_to ? (nameById[m.assigned_to] || null) : null,
      billed_to_id: m.billed_to_id ?? null, billed_to_name: m.billed_to_name ?? null,
      billed_inherited: (m.billed_to_id ?? null) === (root.billed_to_id ?? null),
      facts, amount_htva: amount, amount_note: note, billed_htva: billedHtva || (billedRefs.length && !billedItems.length ? amount : 0),
      billed_refs: billedRefs, nothing_to_bill: nothing, days, regime: kind === 'gard' ? String(m.mission_type || 'autre') : null, redelivery_address: (kind === 'gard' ? root.redelivery_address : m.redelivery_address) || null, amount_unknown: amountUnknown || undefined,
      // Olivier 07/09/2026 : « tout ce qui est modifiable doit l'être dans la vue 2 ».
      editable: kind === 'gard' ? undefined : {
        client_name: m.client_name || null, client_phone: m.client_phone || null, client_address: m.client_address || null,
        assisted_name: m.assisted_name || null, assisted_phone: m.assisted_phone || null,
        vehicle_plate: m.vehicle_plate || null, vehicle_brand: m.vehicle_brand || null, vehicle_model: m.vehicle_model || null, vehicle_vin: m.vehicle_vin || null,
        vehicle_fuel: m.vehicle_fuel || null, vehicle_gearbox: m.vehicle_gearbox || null, vehicle_mileage: m.vehicle_mileage != null ? String(m.vehicle_mileage) : null,
        incident_address: m.incident_address || null, destination_address: m.destination_address || null, destination_name: m.destination_name || null, redelivery_address: m.redelivery_address || null,
        mission_type: m.mission_type || null, source: m.source || null, dossier_number: m.dossier_number || null, intervention_date: m.intervention_date || null,
        incident_type: m.incident_type || null, incident_description: m.incident_description || null, remarks_general: m.remarks_general || null,
      },
      billing_remarks: [
        ...((Array.isArray(m.billing_remarks) ? m.billing_remarks : []).map((r: any) => ({ text: String(r.text || ''), author: r.author_name || null, at: r.created_at || null }))),
        ...(m.remarks_billing && !(Array.isArray(m.billing_remarks) && m.billing_remarks.some((r: any) => r.text === m.remarks_billing)) ? [{ text: String(m.remarks_billing), author: null, at: null }] : []),
      ].filter(r => r.text.trim()),
      payments: (payBy[m.id] || []).map((pz: any) => ({ amount: r2(Number(pz.amount || 0)), mode: pz.payment_mode || null, at: pz.created_at || null, driver: pz.driver_id ? (nameById[pz.driver_id] || null) : null })),
      _sort: startKey(m, kind), _rank: kind === 'rem' ? 0 : kind === 'gard' ? 1 : 2,
    } as any)
  }
  // ── Canal PARQUET : remorquage + gardiennages saisie facturés par état de
  //    frais (module Saisie), jamais par une facture Odoo du dossier.
  // Levée de saisie (dossier Saisie « clos ») : le Parquet ne paie plus rien
  // au-delà de ce qu'il a déjà couvert ; le véhicule est récupéré par le
  // client → ce qui reste se facture au client par Odoo (Olivier 08/09/2026,
  // 2CLN087 : « la récupération a été faite par le client »).
  const levee = !!parquet && parquet.state === 'clos'
  if (parquet && parquet.recipient !== 'client') {
    const efDep = parquet.efs.find(e => e.include_depannage)
    const lastEf = parquet.efs.length ? parquet.efs[parquet.efs.length - 1] : null
    for (const l of legs as any[]) {
      if (l.kind === 'rem' && l.mission_id === root.id) {
        if (levee && !efDep && !parquet.depannage_billed) continue   // rien envoyé au Parquet → client
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
        if (levee && !covered) {   // levée de saisie, période non couverte par un état de frais → client (Odoo)
          l.channel = 'odoo'
          l.status_label = `${l.open ? 'Gardiennage en cours' : 'Terminé'} · à facturer au client (levée de saisie${root.levee_saisie_date ? ' du ' + fmtD(String(root.levee_saisie_date)) : ''})`
          l.status_tone = 'warn'
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
  legs.forEach((l: any, i) => { l.letter = LETTERS[i] || String(i + 1); delete l._sort; delete l._rank })

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
    billed_to: { id: root.billed_to_id ?? null, name: root.billed_to_name ?? null },
    received_at: root.received_at,
    state, legs, events, light: light || undefined,
    parquet,
    stamps: {
      domaine: root.domaine_vente_date ? `Vendu au Domaine${root.domaine_vente_firm ? ' · ' + root.domaine_vente_firm : ''}` : (root.domaine_remise_date ? `Remis au Domaine le ${String(root.domaine_remise_date).slice(0, 10)}` : null),
      touring_check: root.touring_check_stamp || null,
    },
    totals: { estimated, billed, collected, remaining: r2(Math.max(0, estimated - billed)) },
    invoices: Object.values(invMap).map(e => ({ ...e, covers: Array.from(e.covers).sort() })),
  }
}

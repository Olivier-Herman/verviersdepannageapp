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
  // Mode léger : pas de montant figé sur la fiche → à calculer (moteur de prix).
  amount_unknown?: boolean
}

export interface DossierEvent {
  at:         string
  mission_id: string
  source:     string | null
  label:      string
  detail:     string | null
  kind:       'cancelled' | 'ignored' | 'a_verifier' | 'orphan' | 'autre_dossier'
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
  legs:           DossierLeg[]
  events:         DossierEvent[]
  totals:         { estimated: number; billed: number; collected: number; remaining: number }
  light?:         boolean
  invoices:       { number: string; covers: string[]; client: string | null; amount: number; at: string | null; url: string | null }[]
}

const DAY_MS = 86_400_000
const ts  = (v: string | null | undefined) => (v ? new Date(v).getTime() : null)
const r2  = (n: number) => Math.round(n * 100) / 100
const fmtD = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const normPlate = (p: string | null | undefined) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const REGIME_LABEL: Record<string, string> = { assistance: 'assistance', saisie: 'saisie', siabis: 'Siabis', autre: 'autre' }

const CHAIN_COLS = `id, mission_number, external_id, dossier_number, source, source_format, status, mission_type, incident_type,
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
    case 'delivering':  return { label: 'Véhicule chargé', tone: 'live' }
    case 'in_progress': return { label: 'En cours', tone: 'live' }
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

  const { data: m0, error: e0 } = await sb.from('incoming_missions').select(CHAIN_COLS).eq('id', anyMissionId).maybeSingle()
  if (e0) console.error('[dossier/build]', e0.message)
  if (!m0) return null
  let root: any = m0
  if ((m0 as any).parent_mission_id) {
    const { data: p } = await sb.from('incoming_missions').select(CHAIN_COLS).eq('id', (m0 as any).parent_mission_id).maybeSingle()
    if (p) root = p
  }

  const { data: kidsRaw } = await sb.from('incoming_missions').select(CHAIN_COLS)
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
  const { data: items } = await sb.from('mission_billed_items')
    .select('mission_id, kind, label, amount_htva, invoice_number, billed_to_name, billed_at, odoo_quote_id, invoice_odoo_id, dossier_letter')
    .in('mission_id', ids)
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

  // Estimation du REM racine (sert de repli pour le prix/jour et donne la part
  // hors gardiennage).
  let rootEst: any = null
  if (!light) { try { rootEst = await estimateMissionPrice(root) } catch { rootEst = null } }

  // ── Construction des groupes ─────────────────────────────────────────────
  const legs: DossierLeg[] = []
  for (const m of legRows) {
    const kind = kindOf(m)
    const st = statusOf(m, kind)
    const billedItems = itemsBy[m.id] || []
    const billedHtva = r2(billedItems.reduce((s, it) => s + Number(it.amount_htva || 0), 0))
    const billedRefs = Array.from(new Set([
      ...billedItems.map(refOf).filter(Boolean),
      ...(m.invoice_number ? [m.invoice_number] : (m.invoice_odoo_id && !billedItems.length ? [`brouillon Odoo #${m.invoice_odoo_id}`] : [])),
    ])) as string[]

    let amount = 0, note: string | null = null, nothing: string | null = null, days: number | null = null, amountUnknown = false
    const facts: { label: string; value: string }[] = []
    let title = '', subtitle = '', started: string | null = null, ended: string | null = null, open = false

    if (kind === 'gard') {
      const regime = String(m.mission_type || 'autre')
      const entry = ts(m.parked_at) || ts(m.received_at) || Date.now()
      const exit  = ts(m.parc_exit_at)
      open = !exit
      const rawDays = Math.max(1, Math.ceil(((exit ?? Date.now()) - entry) / DAY_MS))
      const tarif = dayPriceByRegime[regime]
      let dayPrice = tarif?.price || 0
      if (!dayPrice && rootEst?.parc_jours > 0) dayPrice = r2(Number(rootEst.parc_eur) / Number(rootEst.parc_jours))
      days = Math.max(0, rawDays - (tarif?.free || 0))
      if (m.storage_waived) { amount = 0; nothing = 'gardiennage offert (abandon volontaire)' }
      else if (Number(m.storage_flat_htva) > 0) { amount = r2(Number(m.storage_flat_htva)); note = 'forfait gardiennage' }
      else { amount = r2(days * dayPrice); note = dayPrice ? `${days} j × ${dayPrice.toFixed(2)} €` : `${days} j · tarif journalier introuvable` }
      title = 'Gardiennage'
      subtitle = [`régime ${REGIME_LABEL[regime] || regime}`, m.parc_zone_key ? `zone ${m.parc_zone_key}` : null, m.parc_row_number != null ? `rangée ${m.parc_row_number}` : null].filter(Boolean).join(' · ')
      started = m.parked_at || m.received_at; ended = m.parc_exit_at
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
      let est: any = null
      if (!light) { try { est = m.id === root.id ? rootEst : await estimateMissionPrice(m) } catch { est = null } }
      if (Number(m.special_tarif_htva) > 0) { amount = r2(Number(m.special_tarif_htva)); note = 'prix convenu' }
      else if (light) { amount = r2(Number(m.estimated_htva) || 0); note = Number(m.estimated_htva) > 0 ? 'estimation figée' : 'estimation à calculer'; if (!(Number(m.estimated_htva) > 0)) amountUnknown = true }
      else if (est?.ok) {
        const parcPart = Number(est.parc_eur || 0) * (1 + Number(est.surcharge_pct || 0) / 100)
        amount = r2(Math.max(0, Number(est.total_eur || 0) - parcPart))
        note = [est.forfait ? `forfait ${Number(est.forfait).toFixed(2)} €` : null, est.km_extra > 0 ? `${est.km_extra} km suppl.` : null, est.surcharge_pct ? `+${est.surcharge_pct} %` : null].filter(Boolean).join(' · ') || null
        if (amount === 0 && kind === 'rel' && m.status !== 'completed' && m.status !== 'to_invoice') nothing = null
      } else if (Number(m.estimated_htva) > 0) { amount = r2(Number(m.estimated_htva)); note = 'estimation figée' }
      else { amount = 0; note = est?.reason || 'tarif introuvable' }
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
      billed_refs: billedRefs, nothing_to_bill: nothing, days, regime: kind === 'gard' ? String(m.mission_type || 'autre') : null, amount_unknown: amountUnknown || undefined,
      _sort: startKey(m, kind), _rank: kind === 'rem' ? 0 : kind === 'gard' ? 1 : 2,
    } as any)
  }
  legs.sort((a: any, b: any) => (a._sort - b._sort) || (a._rank - b._rank))
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  legs.forEach((l: any, i) => { l.letter = LETTERS[i] || String(i + 1); delete l._sort; delete l._rank })

  // ── Événements (mails sans action) ───────────────────────────────────────
  const events: DossierEvent[] = eventRows.map((e: any): DossierEvent => ({
    at: e.received_at, mission_id: e.id, source: e.source,
    label: e._other
      ? `Autre dossier #${e.mission_number ?? '?'} pour la même plaque — ${getMissionTypeLabel(e.mission_type, 'long')} ${sourceLabel(e.source)}, ${statusOf(e, 'rem').label.toLowerCase()}`
      : e._orphan
      ? (e._verify ? `Mail ${sourceLabel(e.source)} pour la même plaque, autre n° de dossier (${e.dossier_number}) — à vérifier` : `Mail ${sourceLabel(e.source)} reçu, sans action (${statusOf(e, 'rem').label.toLowerCase()})`)
      : `${getMissionTypeLabel(e.mission_type, 'long')} ${sourceLabel(e.source)} — ${statusOf(e, 'rem').label.toLowerCase()}`,
    detail: e._other ? null : (e.cancelled_reason || e.closing_notes || null),
    kind: (e._other ? 'autre_dossier' : e._orphan ? (e._verify ? 'a_verifier' : 'orphan') : (e.status === 'cancelled' ? 'cancelled' : 'ignored')) as DossierEvent['kind'],
    mission_number: e.mission_number ?? null, status: e.status,
  })).sort((a, b) => (ts(a.at) || 0) - (ts(b.at) || 0))

  // ── Totaux + factures ────────────────────────────────────────────────────
  const estimated = r2(legs.reduce((s, l) => s + l.amount_htva, 0))
  const billed    = r2(legs.reduce((s, l) => s + l.billed_htva, 0))
  const collected = r2(legRows.reduce((s, m) => s + Number(m.payment_amount || m.amount_collected || 0), 0))
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

  const openLeg = legs.find(l => l.kind === 'gard' && l.open)
  const relPending = legs.find(l => l.kind === 'rel' && l.open)
  const state = openLeg ? { open: true, reason: `véhicule au parc${openLeg.subtitle ? ' · ' + openLeg.subtitle.replace(/^régime [^·]+ · /, '') : ''}` }
    : relPending ? { open: true, reason: 'relivraison en cours' }
    : legs.some(l => l.open) ? { open: true, reason: 'intervention en cours' }
    : { open: false, reason: null }

  return {
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
    totals: { estimated, billed, collected, remaining: r2(Math.max(0, estimated - billed)) },
    invoices: Object.values(invMap).map(e => ({ ...e, covers: Array.from(e.covers).sort() })),
  }
}

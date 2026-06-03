// src/lib/odoo-fourriere-flows.ts
//
// Workflows Odoo specifiques au module fourriere (inventaire + entree
// d un nouveau vehicule). Reutilise odooRpc avec l acteur courant
// (withOdooActor) pour tracer les actions au nom du user.
//
// Port adapte de Verviers-QR pages/api/inventory/process.js + reprint.js.

import { odooRpc }              from '@/lib/odoo'
import { createAdminClient }    from '@/lib/supabase'
import { buildParcLabelZPL }    from '@/lib/print/zpl-templates/parc-label'
import { printZPLRaw }          from '@/lib/print/zebra-raw'
import { scrapeTowsoftMissionPuppeteer } from '@/lib/towsoft-scrape-puppeteer'

const HELPDESK_TEAM_ID = 5    // Equipe "fourriere" (a verifier dans Odoo si change)

const ZEBRA_URL = process.env.ZEBRA_REMOTE || ''
const QR_BASE   = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/v`
  : 'https://verviers-qr.vercel.app/v'

// ─────────────────────────────────────────────────────────────────────
// fleet.vehicle.tag : tag mensuel pour l inventaire (ex: "052026")
// ─────────────────────────────────────────────────────────────────────

export function getCurrentInventoryTag(): string {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`
}

export async function ensureFleetTag(tagName: string): Promise<number> {
  const existing = await odooRpc<any[]>('fleet.vehicle.tag', 'search_read', [
    [['name', '=', tagName]],
  ], { fields: ['id'], limit: 1 })
  if (existing && existing.length > 0) return existing[0].id
  return await odooRpc<number>('fleet.vehicle.tag', 'create', [{ name: tagName }])
}

export async function addTagToVehicle(vehicleId: number, tagId: number): Promise<boolean> {
  const current = await odooRpc<any[]>('fleet.vehicle', 'read', [
    [vehicleId],
  ], { fields: ['tag_ids'] })
  const existingTagIds: number[] = current?.[0]?.tag_ids || []
  if (existingTagIds.includes(tagId)) return false  // deja taggue
  await odooRpc('fleet.vehicle', 'write', [[vehicleId], { tag_ids: [[4, tagId]] }])
  return true
}

// ─────────────────────────────────────────────────────────────────────
// fleet.vehicle : find or create avec marque/modele
// ─────────────────────────────────────────────────────────────────────

async function findOrCreateBrand(brand: string): Promise<number> {
  const found = await odooRpc<any[]>('fleet.vehicle.model.brand', 'search_read', [
    [['name', 'ilike', brand]],
  ], { fields: ['id'], limit: 1 })
  if (found && found.length > 0) return found[0].id
  return await odooRpc<number>('fleet.vehicle.model.brand', 'create', [{ name: brand }])
}

async function findOrCreateModel(brandId: number, model: string): Promise<number> {
  const found = await odooRpc<any[]>('fleet.vehicle.model', 'search_read', [
    [['name', 'ilike', model], ['brand_id', '=', brandId]],
  ], { fields: ['id'], limit: 1 })
  if (found && found.length > 0) return found[0].id
  return await odooRpc<number>('fleet.vehicle.model', 'create', [{
    name: model, brand_id: brandId,
  }])
}

export interface VehicleLookupParams {
  plaque?:  string
  vin?:     string
  marque?:  string
  modele?:  string
  stateId?: number
}

export interface VehicleLookupResult {
  vehicleId: number
  plate:     string | null
  vin:       string | null
  stateId:   number | null
  created:   boolean
}

/**
 * Recherche un vehicule par plaque ou suffixe VIN. Cree si absent (avec
 * marque + modele si fournis). Retourne l id + statut "created" pour
 * differencier dans les stats inventaire.
 */
export async function findOrCreateInventoryVehicle(params: VehicleLookupParams): Promise<VehicleLookupResult> {
  // 1. Recherche par plaque
  if (params.plaque) {
    const found = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
      [['license_plate', '=', params.plaque]],
    ], { fields: ['id', 'license_plate', 'vin_sn', 'state_id'], limit: 1 })
    if (found && found.length > 0) {
      return {
        vehicleId: found[0].id,
        plate:     found[0].license_plate || null,
        vin:       found[0].vin_sn || null,
        stateId:   found[0].state_id?.[0] || null,
        created:   false,
      }
    }
  }

  // 2. Recherche par suffixe VIN (5 derniers chars)
  if (params.vin && params.vin.length >= 5) {
    const suffix = params.vin.slice(-5)
    const found = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
      [['vin_sn', 'like', `%${suffix}`]],
    ], { fields: ['id', 'license_plate', 'vin_sn', 'state_id'], limit: 1 })
    if (found && found.length > 0) {
      return {
        vehicleId: found[0].id,
        plate:     found[0].license_plate || null,
        vin:       found[0].vin_sn || null,
        stateId:   found[0].state_id?.[0] || null,
        created:   false,
      }
    }
  }

  // 3. Pas trouve : creation
  let modelId: number | null = null
  if (params.marque) {
    const brandId = await findOrCreateBrand(params.marque)
    if (params.modele) {
      modelId = await findOrCreateModel(brandId, params.modele)
    }
  }

  const plateToUse = params.plaque
    || (params.vin ? params.vin.slice(-5) : `INV-${Date.now()}`)

  const createData: any = {
    license_plate: plateToUse,
    state_id:      params.stateId || false,
  }
  if (params.vin) createData.vin_sn = params.vin
  if (modelId)    createData.model_id = modelId

  const newId = await odooRpc<number>('fleet.vehicle', 'create', [createData])
  const newVehicle = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
    [['id', '=', newId]],
  ], { fields: ['id', 'license_plate', 'vin_sn', 'state_id'], limit: 1 })

  return {
    vehicleId: newId,
    plate:     newVehicle?.[0]?.license_plate || plateToUse,
    vin:       newVehicle?.[0]?.vin_sn || null,
    stateId:   newVehicle?.[0]?.state_id?.[0] || params.stateId || null,
    created:   true,
  }
}

// ─────────────────────────────────────────────────────────────────────
// helpdesk.ticket : get or create pour un vehicule (mission Towsoft)
// ─────────────────────────────────────────────────────────────────────

export interface HelpdeskTicketParams {
  vehicleId:   number
  missionNum?: string | null
  refDossier?: string | null
  dateMission?: string | null
}

export interface HelpdeskTicketResult {
  ticketId: number
  created:  boolean
}

export async function getOrCreateInventoryTicket(params: HelpdeskTicketParams): Promise<HelpdeskTicketResult> {
  // 1. Chercher un ticket existant par n° mission Towsoft
  if (params.missionNum) {
    const found = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
      [['x_studio_mission_towsoft', '=', String(params.missionNum)]],
    ], { fields: ['id'], limit: 1 })
    if (found && found.length > 0) {
      return { ticketId: found[0].id, created: false }
    }
  }

  // 2. Creation
  const ticketData: any = {
    name:                          `Inventaire - ${params.refDossier || params.missionNum || 'QR'}`,
    team_id:                       HELPDESK_TEAM_ID,
    x_studio_fiche_vehicule:       params.vehicleId,
    x_studio_mission_towsoft:      String(params.missionNum || ''),
  }
  if (params.dateMission) {
    ticketData.x_studio_date_dentree = String(params.dateMission).split(' ')[0]
  }

  const ticketId = await odooRpc<number>('helpdesk.ticket', 'create', [ticketData])
  return { ticketId, created: true }
}

// ─────────────────────────────────────────────────────────────────────
// Imprimante Zebra : appel via ngrok existant
// ─────────────────────────────────────────────────────────────────────

export interface PrintLabelParams {
  ticketId: number
  motif?:   string
  date?:    string         // DD/MM/YY
  note?:    string
  plate?:   string
  vin?:     string
  brand?:   string
  model?:   string
}

export async function printZebraLabel(params: PrintLabelParams): Promise<boolean> {
  if (!ZEBRA_URL) {
    console.warn('[zebra] ZEBRA_REMOTE non configure')
    return false
  }
  try {
    const res = await fetch(`${ZEBRA_URL.replace(/\/$/, '')}/print`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        qrUrl: `${QR_BASE}/${params.ticketId}`,
        motif: params.motif || '',
        date:  params.date || '',
        note:  params.note || '',
        plate: params.plate || '',
        vin:   params.vin || '',
        brand: params.brand || '',
        model: params.model || '',
      }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    return data?.ok === true
  } catch (e: any) {
    console.warn('[zebra] print fail:', e.message)
    return false
  }
}

// Olivier 2026-06-03 : mapping motif TowSoft -> source VD Soft (pour calcul tarif).
// Le motif TowSoft est case-insensitive et peut varier (Accident, Mal Garée,
// Mal Garee, Saisie, Saisie judiciaire, etc.). On match sur des contains.
function inferSourceFromMotif(motif: string | null): string | null {
  if (!motif) return null
  const m = motif.toLowerCase().trim()
  if (m.includes('mal') && m.includes('gar'))   return 'police_mg'
  if (m.includes('accident'))                   return 'police_accident'
  if (m.includes('saisie'))                     return 'police_saisie'
  if (m.includes('rodeo') || m.includes('rodéo')) return 'police_rodeo'
  if (m.includes('avp') || m.includes('abandon')) return 'police_avp'
  if (m.includes('siabis non couvert'))         return 'police_snc'
  if (m.includes('siabis couvert'))             return 'sia_couvert'
  if (m.includes('privé') || m.includes('prive')) return 'prive'
  return null
}

/**
 * Parse une date TowSoft (formats varies) vers ISO en LOCALE Bruxelles.
 * Formats attendus :
 *   - 'YYYY-MM-DD HH:MM:SS'    (date appel + heure)
 *   - 'YYYY-MM-DD'             (date seule)
 *   - 'DD-MM-YYYY HH:MM(:SS)?' (mise en parc)
 *   - 'DD-MM-YYYY'             (date seule format europe)
 *
 * On evite d ecraser l heure avec 00:00 quand on n a que la date :
 * dans ce cas, on retourne null pour ne pas polluer.
 */
function parseTowsoftDate(s: string | null): string | null {
  if (!s) return null
  const trimmed = s.trim()
  // YYYY-MM-DD HH:MM(:SS)?
  const m1 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m1) {
    // Construit en LOCALE (sans T...Z) puis on traduit en ISO en assumant
    // que TowSoft donne du temps local Belgique. Pour eviter le drift UTC,
    // on cree la Date avec Date.UTC + offset Belgique (2h ete / 1h hiver).
    // Simple : passe par new Date('YYYY-MM-DDTHH:MM:SS') -> JS interprete UTC.
    // On compense en soustrayant l offset local pour obtenir le bon UTC.
    const local = new Date(`${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:${m1[6] || '00'}`)
    // local.getTime() est l UTC qui correspond a cette date INTERPRETEE comme UTC.
    // On veut que les chiffres saisis (10-04-2026 18:55) representent le LOCAL Brussels.
    // Donc on doit retirer l offset de Brussels pour obtenir le bon UTC.
    // getTimezoneOffset() retourne minutes UTC - locale. Pour le serveur Vercel
    // (UTC), getTimezoneOffset = 0. On force donc le calcul manuel :
    // Brussels = UTC+1 en hiver, UTC+2 en ete. On utilise Intl pour determiner.
    const offsetMs = brusselsOffsetMs(local)
    return new Date(local.getTime() - offsetMs).toISOString()
  }
  // DD-MM-YYYY HH:MM(:SS)?
  const m2 = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m2) {
    const local = new Date(`${m2[3]}-${m2[2]}-${m2[1]}T${m2[4]}:${m2[5]}:${m2[6] || '00'}`)
    const offsetMs = brusselsOffsetMs(local)
    return new Date(local.getTime() - offsetMs).toISOString()
  }
  // YYYY-MM-DD (date seule)
  const m3 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m3) {
    // Date seule -> on met 12:00 Belgique pour eviter de basculer un jour
    const local = new Date(`${m3[1]}-${m3[2]}-${m3[3]}T12:00:00`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  // DD-MM-YYYY (date seule)
  const m4 = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (m4) {
    const local = new Date(`${m4[3]}-${m4[2]}-${m4[1]}T12:00:00`)
    return new Date(local.getTime() - brusselsOffsetMs(local)).toISOString()
  }
  return null
}

/** Offset Brussels par rapport a UTC en ms a une date donnee. */
function brusselsOffsetMs(d: Date): number {
  // On compare l affichage locale Brussels vs UTC
  const localeStr = d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' })
  const utcStr    = d.toLocaleString('en-US', { timeZone: 'UTC' })
  return (new Date(localeStr).getTime() - new Date(utcStr).getTime())
}

/**
 * Enrichit une mission VD Soft (vdMissionId) avec les donnees TowSoft.
 * Reutilise par reprintInventoryLabel (scan) et /api/admin/parc/enrich-batch
 * (batch manuel pour les missions qui ont rate le scraping).
 *
 * Retourne { ok, updated, reason } pour stats.
 */
export async function enrichMissionFromTowsoft(
  vdMissionId: string,
  towsoftNum:  string,
): Promise<{ ok: boolean; updated: boolean; reason?: string }> {
  const sb = createAdminClient()
  const { data: vdMission } = await sb
    .from('incoming_missions')
    .select('id, mission_number, status, dossier_number, intervention_date, parked_at, source, towsoft_enriched_at')
    .eq('id', vdMissionId)
    .maybeSingle()
  if (!vdMission) return { ok: false, updated: false, reason: 'mission introuvable' }
  if (vdMission.towsoft_enriched_at) {
    return { ok: true, updated: false, reason: 'deja enrichie' }
  }

  const scrapeRes = await scrapeTowsoftMissionPuppeteer(towsoftNum)
  if (!scrapeRes.ok || !scrapeRes.data) {
    return { ok: false, updated: false, reason: `scrape KO : ${scrapeRes.error}` }
  }
  const ts = scrapeRes.data
  const updates: Record<string, any> = {}

  if (!vdMission.dossier_number && ts.refDossier) updates.dossier_number = ts.refDossier

  // Date intervention : parsing robuste (heure preservee, offset Bruxelles)
  const interventionIso = parseTowsoftDate(ts.dateMission)
  if (interventionIso) {
    updates.intervention_date = interventionIso
    // Olivier 2026-06-03 : parked_at = intervention_date (la voiture est entree
    // en parc a l intervention pour ces missions legacy). Permet le bon calcul
    // de gardiennage.
    updates.parked_at = interventionIso
  }

  if (ts.plaque && !vdMission.dossier_number) updates.vehicle_plate = String(ts.plaque).toUpperCase()
  if (ts.marque)  updates.vehicle_brand = ts.marque
  if (ts.modele)  updates.vehicle_model = ts.modele
  if (ts.vin)     updates.vehicle_vin   = ts.vin
  if (ts.ownerLastName || ts.ownerFirstName) {
    updates.client_name = [ts.ownerFirstName, ts.ownerLastName].filter(Boolean).join(' ')
  }
  if (ts.ownerPhone)       updates.client_phone   = ts.ownerPhone
  if (ts.ownerAddress)     updates.client_address = ts.ownerAddress
  if (ts.interventionAddr) updates.incident_address = ts.interventionAddr
  if (ts.officerName)      updates.officer_name   = ts.officerName
  if (ts.policeZone)       updates.police_zone    = ts.policeZone
  if (ts.pvNumber)         updates.police_pv_number = ts.pvNumber
  if (ts.billedTo && !vdMission.dossier_number) updates.billed_to_name = ts.billedTo
  if (ts.keysDigiboxSlot)  updates.keys_digibox_slot = ts.keysDigiboxSlot

  // Source : derivee du motif TowSoft (Accident -> police_accident, etc.).
  // Permet a estimateMissionPrice de calculer le bon tarif.
  const inferredSource = inferSourceFromMotif(ts.motif)
  if (inferredSource) {
    updates.source = inferredSource
    // Mission type par defaut pour ces legacy police -> remorquage
    // (le scraper ne retourne pas precisement REM vs DSP, mais en pratique
    // c est tout des remorquages pour les vehicules en parc).
    updates.mission_type = 'remorquage'
  }

  // Tag enriched dans une colonne dediee (pas dans source pour pouvoir
  // calculer le tarif basee sur la VRAIE source).
  updates.towsoft_enriched_at = new Date().toISOString()

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    const { error: upErr } = await sb.from('incoming_missions').update(updates).eq('id', vdMission.id)
    if (upErr) return { ok: false, updated: false, reason: `update KO : ${upErr.message}` }
    return { ok: true, updated: true }
  }
  return { ok: true, updated: false, reason: 'aucun champ a updater' }
}

function formatDateForLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso.replace(' ', 'T'))
    if (isNaN(d.getTime())) return ''
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
  } catch { return '' }
}

// ─────────────────────────────────────────────────────────────────────
// Flow inventaire : reimpression pour QR Verviers-QR existant
// ─────────────────────────────────────────────────────────────────────

export interface ReprintParams {
  ticketId:   number
  tagName?:   string   // tag mensuel a ajouter sur le vehicule (optionnel)
  stateId?:   number   // forcer un nouveau state_id sur le vehicule
  print?:     boolean  // imprimer une nouvelle etiquette (default false)
}

export interface ReprintResult {
  ticketId:    number
  printed:     boolean
  tagged:      boolean
  // Infos vehicule resolves (utiles pour l historique inventaire + export)
  plate:       string | null
  vin:         string | null
  brand:       string | null
  model:       string | null
  motif:       string | null
  dateEntree:  string | null
  missionNum:  string | null
}

export async function reprintInventoryLabel(params: ReprintParams): Promise<ReprintResult> {
  // 1. Lit le ticket avec champs utiles + fleet lie
  const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
    [['id', '=', params.ticketId]],
  ], {
    fields: ['id', 'tag_ids', 'x_studio_fiche_vehicule', 'x_studio_date_dentree',
             'x_studio_note_sur_etiquette', 'x_studio_mission_towsoft'],
    limit:  1,
  })
  if (!tickets || tickets.length === 0) throw new Error('Ticket introuvable')
  const ticket = tickets[0]

  const fleetId = typeof ticket.x_studio_fiche_vehicule === 'number'
    ? ticket.x_studio_fiche_vehicule
    : Array.isArray(ticket.x_studio_fiche_vehicule) ? ticket.x_studio_fiche_vehicule[0] : null

  // 2. MAJ state_id et tag mensuel sur le vehicule
  let tagged = false
  if (fleetId) {
    if (params.stateId) {
      await odooRpc('fleet.vehicle', 'write', [[fleetId], { state_id: params.stateId }])
    }
    if (params.tagName) {
      const tagId = await ensureFleetTag(params.tagName)
      tagged = await addTagToVehicle(fleetId, tagId)
    }
  }

  // 3. Resolve motif (1er tag helpdesk)
  let motif = ''
  if (ticket.tag_ids?.length > 0) {
    const tags = await odooRpc<any[]>('helpdesk.tag', 'search_read', [
      [['id', 'in', ticket.tag_ids]],
    ], { fields: ['name'], limit: 5 })
    motif = tags?.[0]?.name || ''
  }

  // 4. Resolve vehicule pour l etiquette
  let plate = '', vin = '', brand = '', model = ''
  if (fleetId) {
    const fleets = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
      [['id', '=', fleetId]],
    ], { fields: ['license_plate', 'vin_sn', 'model_id'], limit: 1 })
    if (fleets && fleets.length > 0) {
      plate = fleets[0].license_plate || ''
      vin   = fleets[0].vin_sn || ''
      const modelName = Array.isArray(fleets[0].model_id) ? fleets[0].model_id[1] : ''
      const parts = modelName.split(/[\s\/]+/)
      brand = parts[0] || ''
      model = parts.slice(1).join(' ') || ''
    }
  }

  const note = (ticket.x_studio_note_sur_etiquette && ticket.x_studio_note_sur_etiquette !== false)
    ? String(ticket.x_studio_note_sur_etiquette) : ''

  // Olivier 2026-06-03 : enrichissement TowSoft. Si la mission VD Soft existe
  // (stub cree par prepare-full-inventory) et qu on a le num TowSoft sur le
  // ticket Odoo, on scrape TowSoft pour recuperer dossier, vraie date
  // d intervention, marque/modele/vin/plaque officiels et update la mission.
  const sb = createAdminClient()
  const { data: vdMission } = await sb
    .from('incoming_missions')
    .select('id, mission_number, status, dossier_number, intervention_date, source')
    .eq('odoo_helpdesk_id', params.ticketId)
    .maybeSingle()

  const towsoftNum = ticket.x_studio_mission_towsoft && ticket.x_studio_mission_towsoft !== false
    ? String(ticket.x_studio_mission_towsoft)
    : null

  // Olivier 2026-06-03 : enrichissement TowSoft RETIRE du scan (etait
  // ~15-20s/scan avec Browserless). Maintenant le scan est rapide (~3s) et
  // l enrichissement se fait via /admin/parc -> 'Enrichir manquants' en
  // batch (concurrence 3), apres tous les scans.
  // -- if (vdMission && towsoftNum) { ... enrichMissionFromTowsoft(...) }
  void towsoftNum  // garde la variable lue pour pas d unused warning

  // Impression UNIQUEMENT si demandee explicitement (default off : l inventaire
  // sert a remettre a jour le parc, pas a re-imprimer toutes les etiquettes).
  //
  // Olivier 2026-06-03 : on utilise le NOUVEAU template VD Soft (buildParcLabelZPL
  // + printZPLRaw) au lieu de l ancien template PC. Le QR pointe vers
  // /qr/mission/[number] (hub unifie) si mission VD Soft trouvee, sinon
  // fallback /v/[ticketId].
  let printed = false
  if (params.print) {
    try {
      const qrTarget = vdMission?.mission_number
        ? `/qr/mission/${vdMission.mission_number}`
        : `/v/${params.ticketId}`
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      const zpl = buildParcLabelZPL({
        qrUrl: `${baseUrl}${qrTarget}`,
        motif,
        date:  formatDateForLabel(ticket.x_studio_date_dentree),
        note,
        plate,
        brand,
        model,
        vin,
      })
      const result = await printZPLRaw(zpl)
      printed = result.ok
      if (!result.ok) console.warn('[reprintInventoryLabel] print-raw failed:', result.error)
    } catch (e: any) {
      console.warn('[reprintInventoryLabel] print error:', e.message)
    }
  }

  return {
    ticketId:   params.ticketId,
    printed,
    tagged,
    plate:      plate || null,
    vin:        vin || null,
    brand:      brand || null,
    model:      model || null,
    motif:      motif || null,
    dateEntree: ticket.x_studio_date_dentree || null,
    missionNum: ticket.x_studio_mission_towsoft || null,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Flow inventaire : process complet pour un QR Towsoft (scrape + create)
// ─────────────────────────────────────────────────────────────────────

export interface ProcessTowsoftParams {
  towsoftData: import('./towsoft-scrape').TowsoftMissionInfo
  stateId?:    number
  tagName?:    string  // tag mensuel inventaire (optionnel)
  print?:      boolean // imprimer une etiquette (default false)
}

export interface ProcessTowsoftResult {
  vehicleId:      number
  ticketId:       number
  vehicleCreated: boolean
  ticketCreated:  boolean
  stateUpdated:   boolean
  tagged:         boolean
  printed:        boolean
  plate:          string | null
}

export async function processTowsoftInventory(params: ProcessTowsoftParams): Promise<ProcessTowsoftResult> {
  const t = params.towsoftData

  // 1. Find or create vehicle
  const vehicle = await findOrCreateInventoryVehicle({
    plaque: t.plaque || undefined,
    vin:    t.vin || undefined,
    marque: t.marque || undefined,
    modele: t.modele || undefined,
    stateId: params.stateId,
  })

  // 2. MAJ state_id si different
  let stateUpdated = false
  if (params.stateId && vehicle.stateId !== params.stateId) {
    await odooRpc('fleet.vehicle', 'write', [[vehicle.vehicleId], { state_id: params.stateId }])
    stateUpdated = true
  }

  // 3. Tag mensuel inventaire (si fourni)
  let tagged = false
  if (params.tagName) {
    const tagId = await ensureFleetTag(params.tagName)
    tagged = await addTagToVehicle(vehicle.vehicleId, tagId)
  }

  // 4. Get or create helpdesk ticket
  const ticket = await getOrCreateInventoryTicket({
    vehicleId:   vehicle.vehicleId,
    missionNum:  t.missionNum,
    refDossier:  t.refDossier,
    dateMission: t.dateMission,
  })

  // 5. Print etiquette UNIQUEMENT si demandee
  let printed = false
  if (params.print) {
    printed = await printZebraLabel({
      ticketId: ticket.ticketId,
      motif:    t.motif || '',
      date:     formatDateForLabel(t.dateMission),
      note:     [t.plaque, t.vin].filter(Boolean).join(' | ').slice(0, 40),
      plate:    vehicle.plate || t.plaque || '',
      vin:      vehicle.vin || t.vin || '',
      brand:    t.marque || '',
      model:    t.modele || '',
    })
  }

  return {
    vehicleId:      vehicle.vehicleId,
    ticketId:       ticket.ticketId,
    vehicleCreated: vehicle.created,
    ticketCreated:  ticket.created,
    stateUpdated,
    tagged,
    printed,
    plate:          vehicle.plate || t.plaque || null,
  }
}

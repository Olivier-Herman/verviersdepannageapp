// src/lib/missions/attach-mission-pdf.ts
//
// Orchestre la generation du PDF d'une mission (ou d'une chaine REM+REL) et
// son attachement vers les 3 cibles Odoo : helpdesk.ticket, fleet.vehicle,
// account.move (facture).
//
// Idempotent : si pdf_attached_*_at est deja set sur la mission, on skip ce
// target. Le cron retry et les hooks invoice/driver-action appellent cette
// meme fonction sans duplication.

import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase'
import { attachToOdoo }     from '@/lib/odoo-attachment'
import { MissionPdfDocument, type MissionPdfData } from '@/lib/missions/mission-pdf'

const MAX_PHOTO_WIDTH = 800
const MAX_PHOTOS      = 24      // garde-fou : trop de photos = PDF lourd
const MAX_ATTEMPTS    = 5

const ACTION_LABEL: Record<string, string> = {
  accepted:           'Mission acceptee',
  on_site:            'Arrivee sur place',
  arrive_stop:        'Arrivee stop',
  depart_stop:        'Depart stop',
  start_delivery:     'Debut livraison',
  complete_delivery:  'Livraison terminee',
  completed:          'Mission terminee',
  park:               'Vehicule en parc',
  load_vehicle:       'Vehicule charge',
  save_photos:        'Photos enregistrees',
  cancelled:          'Mission annulee',
  invoiced:           'Mission facturee',
  no_charge:          'Sans frais',
}

interface MissionRow {
  id:                  string
  external_id:         string | null
  dossier_number:      string | null
  source:              string | null
  status:              string
  mission_type:        string | null
  incident_type:       string | null
  parent_mission_id:   string | null
  intervention_date:   string | null
  received_at:         string
  completed_at:        string | null
  client_name:         string | null
  client_phone:        string | null
  vehicle_plate:       string | null
  vehicle_brand:       string | null
  vehicle_model:       string | null
  vehicle_vin:         string | null
  incident_address:    string | null
  destination_address: string | null
  amount_to_collect:   number | null
  amount_collected:    number | null
  payment_method:      string | null
  invoice_method:      'manual' | 'auto' | null
  invoice_number:      string | null
  no_charge_at:        string | null
  no_charge_reason:    string | null
  driver_photos:       string[] | null
  odoo_helpdesk_id:    number | null
  odoo_vehicle_id:     number | null
  invoice_odoo_id:     number | null
  pdf_attached_helpdesk_at: string | null
  pdf_attached_vehicle_at:  string | null
  pdf_attached_invoice_at:  string | null
  pdf_attach_attempts: number
}

function missionKindLabel(m: { mission_type: string | null; incident_type: string | null; parent_mission_id: string | null }): string {
  const it = (m.incident_type || '').toLowerCase()
  const mt = (m.mission_type   || '').toLowerCase()
  if (it === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr')                                return 'DPR'
  if (mt === 'remorquage')                         return 'REM'
  if (['depannage', 'reparation_place', 'trajet_vide'].includes(mt)) return 'DSP'
  return 'AUTRE'
}

/**
 * Telecharge une photo (URL Supabase Storage ou autre) + resize + base64.
 * Best effort : silent fail si une photo est cassee.
 */
async function fetchAndResizePhoto(url: string): Promise<{ src: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    // sharp : resize si necessaire (preserve ratio), output JPEG quality 80
    const resized = await sharp(buf)
      .rotate()                                             // auto-rotate selon EXIF
      .resize({ width: MAX_PHOTO_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
    const b64 = resized.toString('base64')
    return { src: `data:image/jpeg;base64,${b64}` }
  } catch (e: any) {
    console.warn('[attach-mission-pdf] photo fetch/resize fail:', url, e.message)
    return null
  }
}

async function loadMission(missionId: string): Promise<MissionRow | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, status,
      mission_type, incident_type, parent_mission_id,
      intervention_date, received_at, completed_at,
      client_name, client_phone,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      incident_address, destination_address,
      amount_to_collect, amount_collected, payment_method,
      invoice_method, invoice_number, no_charge_at, no_charge_reason,
      driver_photos,
      odoo_helpdesk_id, odoo_vehicle_id, invoice_odoo_id,
      pdf_attached_helpdesk_at, pdf_attached_vehicle_at, pdf_attached_invoice_at,
      pdf_attach_attempts
    `)
    .eq('id', missionId)
    .maybeSingle<MissionRow>()
  return data
}

async function loadMissionLogs(missionId: string): Promise<MissionPdfData['logs']> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('mission_logs')
    .select('action, notes, created_at')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true })
    .limit(50)
  return (data || []).map((l: any) => ({
    actionLabel: ACTION_LABEL[l.action] || l.action,
    notes:       l.notes || null,
    occurredAt:  l.created_at,
  }))
}

async function buildMissionPdfData(m: MissionRow): Promise<MissionPdfData> {
  const logs = await loadMissionLogs(m.id)
  const photoUrls = Array.isArray(m.driver_photos) ? m.driver_photos.slice(0, MAX_PHOTOS) : []
  const photosResults = await Promise.all(photoUrls.map(fetchAndResizePhoto))
  const photosBase64 = photosResults.filter((p): p is { src: string } => p !== null)

  return {
    id:                m.id,
    externalId:        m.external_id,
    dossierNumber:     m.dossier_number,
    source:            m.source,
    status:            m.status,
    missionType:       m.mission_type,
    incidentType:      m.incident_type,
    kindLabel:         missionKindLabel(m),
    interventionDate:  m.intervention_date,
    receivedAt:        m.received_at,
    completedAt:       m.completed_at,
    clientName:        m.client_name,
    clientPhone:       m.client_phone,
    vehiclePlate:      m.vehicle_plate,
    vehicleBrand:      m.vehicle_brand,
    vehicleModel:      m.vehicle_model,
    vehicleVin:        m.vehicle_vin,
    incidentAddress:   m.incident_address,
    destinationAddress: m.destination_address,
    amountToCollect:   m.amount_to_collect != null ? Number(m.amount_to_collect) : null,
    amountCollected:   m.amount_collected != null ? Number(m.amount_collected) : null,
    paymentMode:       m.payment_method,
    invoiceMethod:     m.invoice_method,
    invoiceNumber:     m.invoice_number,
    noChargeAt:        m.no_charge_at,
    noChargeReason:    m.no_charge_reason,
    logs,
    photosBase64,
  }
}

/**
 * Genere le buffer PDF d'une mission ou d'une chaine.
 * Si chainMissionIds = [m] : PDF mission unique.
 * Si chainMissionIds = [m, sibling] : PDF combine.
 */
export async function generateMissionPdfBuffer(missionIds: string[]): Promise<{ buffer: Buffer; filename: string; stamp?: string }> {
  const sb = createAdminClient()
  const { data: missionsRaw } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, status,
      mission_type, incident_type, parent_mission_id,
      intervention_date, received_at, completed_at,
      client_name, client_phone,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      incident_address, destination_address,
      amount_to_collect, amount_collected, payment_method,
      invoice_method, invoice_number, no_charge_at, no_charge_reason,
      driver_photos,
      odoo_helpdesk_id, odoo_vehicle_id, invoice_odoo_id,
      pdf_attached_helpdesk_at, pdf_attached_vehicle_at, pdf_attached_invoice_at,
      pdf_attach_attempts
    `)
    .in('id', missionIds)
  const missions = (missionsRaw || []) as MissionRow[]
  if (missions.length === 0) throw new Error('Aucune mission trouvee')

  // Tri : REM avant REL (parent avant enfant)
  missions.sort((a, b) => {
    const ap = a.parent_mission_id ? 1 : 0
    const bp = b.parent_mission_id ? 1 : 0
    if (ap !== bp) return ap - bp
    return (a.received_at || '').localeCompare(b.received_at || '')
  })

  const pdfDataArray = await Promise.all(missions.map(buildMissionPdfData))

  // Stamp eventuel
  let stamp: string | undefined
  const m0 = missions[0]
  if (m0.no_charge_at)                                 stamp = 'SANS FRAIS'
  else if (m0.invoice_method === 'auto')               stamp = 'AUTO-FACTURÉE'
  else if (m0.invoice_number)                          stamp = 'FACTURÉE'
  else if (m0.status === 'to_invoice')                 stamp = 'À FACTURER'

  const generatedAt = new Date().toISOString()

  const doc = React.createElement(MissionPdfDocument, {
    missions: pdfDataArray,
    generatedAt,
    stamp,
  })

  // renderToBuffer attend un ReactElement<DocumentProps>. Le type retourne par
  // React.createElement(<our component>) est plus large que ce que TS arrive
  // a inferer — cast pour deverrouiller (le composant retourne bien un Document).
  const buffer = await renderToBuffer(doc as any)
  const refSlug = (m0.external_id || m0.dossier_number || m0.id.slice(0, 8))
                    .replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = missions.length > 1
    ? `Mission_${refSlug}_chaine.pdf`
    : `Mission_${refSlug}.pdf`

  return { buffer, filename, stamp }
}

interface AttachOptions {
  /** Si fourni, force l'envoi du chain dans l'attachement invoice (sinon mission seule). */
  chainMissionIds?:  string[]
  /** Quels targets retenter ; default = tous ceux non encore set. */
  targets?: ('helpdesk' | 'vehicle' | 'invoice')[]
}

/**
 * Genere et attache le PDF aux 3 cibles Odoo selon les liens disponibles.
 * Idempotent : ne re-attache pas un target deja set.
 *
 * @returns {attached: string[], skipped: string[], errors: string[]}
 */
export async function attachMissionPdf(missionId: string, opts: AttachOptions = {}): Promise<{
  attached: string[]
  skipped:  string[]
  errors:   string[]
}> {
  const sb = createAdminClient()
  const mission = await loadMission(missionId)
  if (!mission) return { attached: [], skipped: [], errors: ['Mission introuvable'] }

  if (mission.pdf_attach_attempts >= MAX_ATTEMPTS) {
    return { attached: [], skipped: [], errors: [`Max attempts atteint (${MAX_ATTEMPTS})`] }
  }

  const wantedTargets = opts.targets ?? ['helpdesk', 'vehicle', 'invoice']

  // Determine quels targets sont eligibles + pas deja attaches
  const todo: Array<{ kind: string; resModel: string; resId: number }> = []
  if (wantedTargets.includes('helpdesk') && mission.odoo_helpdesk_id && !mission.pdf_attached_helpdesk_at) {
    todo.push({ kind: 'helpdesk', resModel: 'helpdesk.ticket', resId: mission.odoo_helpdesk_id })
  }
  if (wantedTargets.includes('vehicle') && mission.odoo_vehicle_id && !mission.pdf_attached_vehicle_at) {
    todo.push({ kind: 'vehicle', resModel: 'fleet.vehicle', resId: mission.odoo_vehicle_id })
  }
  if (wantedTargets.includes('invoice') && mission.invoice_odoo_id && !mission.pdf_attached_invoice_at) {
    todo.push({ kind: 'invoice', resModel: 'account.move', resId: mission.invoice_odoo_id })
  }

  if (todo.length === 0) {
    return { attached: [], skipped: ['rien à attacher'], errors: [] }
  }

  // Genere le PDF (eventuel chain pour invoice)
  // Note : pour helpdesk + vehicle, on attache le PDF de la mission seule.
  //        pour invoice, si chain demande, on attache le PDF combine.
  const baseIds = [missionId]
  const chainIds = opts.chainMissionIds && opts.chainMissionIds.length > 1
    ? opts.chainMissionIds
    : baseIds

  // Si chain demande mais que helpdesk/vehicle aussi → on genere 2 PDF.
  // Sinon on en genere un seul (chain ou mission unique).
  const needsBoth = chainIds.length > 1 && (todo.some(t => t.kind === 'helpdesk' || t.kind === 'vehicle'))
                                       && (todo.some(t => t.kind === 'invoice'))
  let baseBuffer: Buffer | null = null
  let baseFilename = ''
  let chainBuffer: Buffer | null = null
  let chainFilename = ''
  let stamp: string | undefined

  if (needsBoth) {
    const base = await generateMissionPdfBuffer(baseIds)
    baseBuffer = base.buffer; baseFilename = base.filename; stamp = base.stamp
    const chain = await generateMissionPdfBuffer(chainIds)
    chainBuffer = chain.buffer; chainFilename = chain.filename
  } else {
    const idsToUse = chainIds.length > 1 && todo.some(t => t.kind === 'invoice') ? chainIds : baseIds
    const gen = await generateMissionPdfBuffer(idsToUse)
    baseBuffer = gen.buffer; baseFilename = gen.filename; stamp = gen.stamp
  }

  const attached: string[] = []
  const errors:   string[] = []
  const nowIso = new Date().toISOString()
  const updates: Record<string, any> = {
    pdf_attach_attempts: mission.pdf_attach_attempts + 1,
  }

  for (const t of todo) {
    const useChain = t.kind === 'invoice' && chainBuffer !== null
    const buffer   = useChain ? chainBuffer : baseBuffer
    const filename = useChain ? chainFilename : baseFilename
    if (!buffer) continue
    try {
      const base64 = buffer.toString('base64')
      await attachToOdoo({
        resModel: t.resModel,
        resId:    t.resId,
        filename,
        base64Data: base64,
        mimetype: 'application/pdf',
        description: stamp ? `Rapport mission Verviers Depannage (${stamp})` : 'Rapport mission Verviers Depannage',
      })
      attached.push(t.kind)
      if (t.kind === 'helpdesk') updates.pdf_attached_helpdesk_at = nowIso
      if (t.kind === 'vehicle')  updates.pdf_attached_vehicle_at  = nowIso
      if (t.kind === 'invoice')  updates.pdf_attached_invoice_at  = nowIso
    } catch (e: any) {
      console.error(`[attach-mission-pdf] ${t.kind} fail:`, e.message)
      errors.push(`${t.kind}: ${e.message}`)
    }
  }

  // Reset pdf_last_error si on a au moins un succes et plus rien en erreur
  if (errors.length === 0) {
    updates.pdf_last_error = null
  } else {
    updates.pdf_last_error = errors.join(' · ').slice(0, 500)
  }

  await sb.from('incoming_missions').update(updates).eq('id', missionId)

  // Si chain : mettre a jour aussi le slot invoice sur les autres maillons
  // de la chaine (pour eviter qu'ils soient re-traites par le cron retry)
  if (attached.includes('invoice') && chainIds.length > 1) {
    const others = chainIds.filter(id => id !== missionId)
    if (others.length > 0) {
      await sb.from('incoming_missions').update({
        pdf_attached_invoice_at: nowIso,
      }).in('id', others)
    }
  }

  return { attached, skipped: [], errors }
}

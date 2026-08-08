// src/app/api/facturation/check-siabis-anwb/route.ts
//
// POST — traitement PAR LOT des missions « Siabis NON couvert » (source
// police_snc) à facturer. Pour chaque plaque :
//   1) Odoo : véhicule (fleet.vehicle par plaque) → factures liées
//      (x_studio_factures) → une ligne contient « Siabis » ? Si oui →
//      Facturation OK (status=completed + n° de la facture Odoo).
//   2) Sinon : recherche dans les mailboxes info + administration un mail
//      avec une PIÈCE JOINTE PDF de prise en charge de remorquage ANWB
//      (lue par Claude) → tampon « ANWB {dossier} » + n° de dossier sur la
//      fiche + client ANWB (id 56). La fiche reste à facturer (vers ANWB).
//
// Olivier 2026-08-08.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }          from '@/lib/odoo'
import { searchMailbox, fetchMailFull, fetchAttachmentBytes, SEARCH_MAILBOXES, isGraphConfigured } from '@/lib/graph-mail-search'
import Anthropic            from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const ANWB_PARTNER_ID   = 56
const ANWB_PARTNER_NAME = 'ANWB'
const normPlate = (s: string) => (s || '').replace(/[-.\s]/g, '').toUpperCase()

let cachedClient: Anthropic | null = null
function anthropic(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

// ── Odoo : facture Siabis liée au véhicule (via la fiche parc) ───────────────
async function findSiabisInvoice(plate: string): Promise<{ ref: string } | null> {
  const np = normPlate(plate)
  if (np.length < 3) return null
  const likePattern = '%' + np.split('').join('%') + '%'   // tolérant aux séparateurs
  const vehicles = await odooRpc<any[]>('fleet.vehicle', 'search_read',
    [[['license_plate', 'ilike', likePattern]]], { fields: ['license_plate', 'x_studio_factures'], limit: 20 })
  const veh = (vehicles || []).find(v => normPlate(v.license_plate) === np)
  if (!veh || !Array.isArray(veh.x_studio_factures) || !veh.x_studio_factures.length) return null

  // Une ligne de facture (postée, out_invoice) qui mentionne « Siabis » ?
  const lines = await odooRpc<any[]>('account.move.line', 'search_read',
    [[['move_id', 'in', veh.x_studio_factures], ['name', 'ilike', 'siabis'],
      ['parent_state', '=', 'posted'], ['move_id.move_type', '=', 'out_invoice']]],
    { fields: ['move_id'], limit: 1 })
  if (!lines?.length) return null
  const moveId = Array.isArray(lines[0].move_id) ? lines[0].move_id[0] : lines[0].move_id
  const moves = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['name'] })
  return { ref: String(moves?.[0]?.name || moveId) }
}

// ── Claude : lit un PDF et confirme une prise en charge remorquage ANWB ──────
async function extractAnwbFromPdf(base64: string): Promise<{ ok: boolean; dossier: string | null; plate: string | null }> {
  const resp = await createWithModelFallback(anthropic(), ANTHROPIC_MODELS, {
    max_tokens: 400,
    system: `Tu lis un document PDF. Détermine si c'est une PRISE EN CHARGE de REMORQUAGE / transfert émise par ANWB (ANWB Alarmcentrale / ANWB B.V. / ARC Europe). Retourne UNIQUEMENT un JSON strict :
{ "is_anwb_towing": <bool>, "dossier": <string|null>, "plate": <string|null> }
- is_anwb_towing = true seulement si c'est bien un document ANWB de mission de transfert/remorquage (dépannage).
- dossier = la valeur du champ « Numéro de dossier » (ex. 26080752618). PAS le numéro de mission.
- plate = l'immatriculation du véhicule.
Aucun texte hors du JSON.`,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Analyse ce document et retourne le JSON.' },
      ],
    }],
  })
  const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const j = JSON.parse(cleaned)
    return { ok: !!j.is_anwb_towing, dossier: j.dossier ? String(j.dossier).trim() : null, plate: j.plate ? String(j.plate).trim() : null }
  } catch { return { ok: false, dossier: null, plate: null } }
}

// ── Recherche ANWB dans info + administration ────────────────────────────────
async function findAnwbPickup(plate: string): Promise<{ dossier: string } | null> {
  const boxes = SEARCH_MAILBOXES.filter(mb => mb.category === 'email_info' || mb.category === 'email_administration')
  const np = normPlate(plate)
  for (const mb of boxes) {
    let hits
    try { hits = await searchMailbox({ mailbox: mb, query: plate, top: 15 }) } catch { continue }
    // Priorité aux mails qui sentent l'ANWB (expéditeur / objet), sinon tous.
    const anwb = hits.filter(h => /anwb/i.test(h.from) || /anwb/i.test(h.subject) || /anwb/i.test(h.bodyPreview))
    const candidates = (anwb.length ? anwb : hits).slice(0, 6)
    for (const h of candidates) {
      let full
      try { full = await fetchMailFull({ mailbox: mb.email, messageId: h.id }) } catch { continue }
      if (!full?.hasAttachments) continue
      const pdf = (full.attachments || []).find(a => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.name || ''))
      if (!pdf) continue
      let att
      try { att = await fetchAttachmentBytes({ mailbox: mb.email, messageId: h.id, attachmentId: pdf.id }) } catch { continue }
      if (!att) continue
      const b64 = Buffer.from(att.bytes).toString('base64')
      let ex
      try { ex = await extractAnwbFromPdf(b64) } catch { continue }
      // Confirme ANWB + dossier ; si Claude lit une plaque, elle doit matcher.
      if (ex.ok && ex.dossier && (!ex.plate || normPlate(ex.plate) === np)) return { dossier: ex.dossier }
    }
  }
  return null
}

export async function POST() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean)
  const modules: string[] = user?.modules || []
  const ok = roles.some((r: string) => ['admin', 'superadmin'].includes(r)) || modules.includes('facturation')
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: missions } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, dossier_number, billed_to_id, touring_check_stamp')
    .eq('status', 'to_invoice').eq('source', 'police_snc')
    .not('vehicle_plate', 'is', null)

  const graphOk = isGraphConfigured()
  const results: any[] = []
  let facturees = 0, anwbTag = 0, rien = 0

  for (const m of (missions || [])) {
    const plate = String(m.vehicle_plate || '').trim()
    if (!plate) continue
    try {
      // 1) Odoo : facture Siabis existante ?
      const inv = await findSiabisInvoice(plate)
      if (inv) {
        await sb.from('incoming_missions').update({
          status: 'completed', invoice_number: inv.ref, invoice_method: 'manual', updated_at: new Date().toISOString(),
        }).eq('id', m.id)
        await sb.from('mission_logs').insert({ mission_id: m.id, action: 'siabis_invoice_matched',
          notes: `Facture Siabis trouvée dans Odoo (${inv.ref}) → Facturation OK.`, metadata: { ref: inv.ref } }).then(() => {}, () => {})
        facturees++; results.push({ mission: m.mission_number, plate, outcome: `Facturé Siabis — ${inv.ref}` })
        continue
      }
      // 2) ANWB : prise en charge dans info/administration ?
      if (graphOk) {
        const anwb = await findAnwbPickup(plate)
        if (anwb) {
          await sb.from('incoming_missions').update({
            dossier_number:  anwb.dossier,
            billed_to_id:    ANWB_PARTNER_ID,
            billed_to_name:  ANWB_PARTNER_NAME,
            touring_check_stamp: `ANWB ${anwb.dossier}`,
            updated_at: new Date().toISOString(),
          }).eq('id', m.id)
          await sb.from('mission_logs').insert({ mission_id: m.id, action: 'anwb_pickup_matched',
            notes: `Prise en charge ANWB trouvée (dossier ${anwb.dossier}) → client ANWB + tampon.`, metadata: { dossier: anwb.dossier } }).then(() => {}, () => {})
          anwbTag++; results.push({ mission: m.mission_number, plate, outcome: `Prise en charge ANWB — dossier ${anwb.dossier}` })
          continue
        }
      }
      rien++; results.push({ mission: m.mission_number, plate, outcome: 'Rien trouvé' })
    } catch (e: any) {
      results.push({ mission: m.mission_number, plate, outcome: `Erreur : ${e?.message || e}` })
    }
  }

  return NextResponse.json({ ok: true, scanned: (missions || []).length, facturees, anwb: anwbTag, rien, graphOk, results })
}

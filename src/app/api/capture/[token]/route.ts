// src/app/api/capture/[token]/route.ts
//
// Capture depuis le téléphone (page /capture/[token], PUBLIQUE : le jeton
// à usage unique, 15 min, tient lieu d'accès — il a été créé depuis la fiche
// par un utilisateur connecté, qui reste l'auteur des pièces).
//
// GET  → { status: 'pending'|'used'|'expired', kind, mission, preview }
// POST → multipart (files[] + qr_raw?) pour id_card / cmr / informex
//        JSON { signature, signer_name } pour signature
//   1. stocke les photos dans le bucket mission-documents (+ mission_documents)
//   2. lit le document (Claude Vision) et alimente le contrôle de sortie
//   3. signature → fige l'attestation d'enlèvement (instantané + PNG)
//   4. marque le jeton utilisé (la fiche, qui interroge le jeton, se rafraîchit)
// Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import sharp                 from 'sharp'
import { createAdminClient } from '@/lib/supabase'
import { extractJsonFromImages, ID_DOCUMENT_PROMPT, CMR_PROMPT, INFORMEX_PROMPT } from '@/lib/ocr/vision-json'
import { getExitControlState, informexMatch } from '@/lib/missions/exit-control'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'mission-documents'
const MAX_OCR_IMAGES = 3

async function loadToken(sb: any, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data } = await sb.from('capture_tokens')
    .select('id, mission_id, kind, created_by, expires_at, used_at').eq('id', token).maybeSingle()
  return data || null
}
const tokenStatus = (t: any) =>
  t.used_at ? 'used' : new Date(t.expires_at).getTime() < Date.now() ? 'expired' : 'pending'

const roleLabel = (r?: string | null) => r === 'mandate' ? 'mandataire de l\'acheteur' : r === 'transporter' ? 'transporteur' : 'acheteur'

async function buildPreview(sb: any, mission: any, kind: string) {
  if (kind !== 'signature') return null
  const state = await getExitControlState(sb, mission.id)
  const c = state.control || {}
  let releasedBy: string | null = null
  return {
    armed:        state.armed,
    path:         c.path || null,
    destination:  c.path_destination || null,
    informex:     c.informex_doc ? { reference: c.informex_doc.reference || null, buyerName: c.informex_doc.buyerName || null } : null,
    informex_qr:  c.informex_qr_raw ? true : false,
    identity:     c.identity || null,
    identity_role: c.identity_role || null,
    mandate_note: c.mandate_note || null,
    company:      c.company || null,
    cmr:          c.cmr ? { cmrNumber: c.cmr.cmrNumber || null, carrier: c.cmr.carrier || null, truckPlate: c.cmr.truckPlate || null } : null,
    checks:       state.checks,
    missing:      state.reason,
    released_by:  releasedBy,
  }
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const tok = await loadToken(sb, params.token)
  if (!tok) return NextResponse.json({ status: 'expired', error: 'Lien invalide' }, { status: 404 })
  const { data: mission } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, source')
    .eq('id', tok.mission_id).maybeSingle()
  const status = tokenStatus(tok)
  return NextResponse.json({
    status, kind: tok.kind,
    mission: mission ? {
      id: mission.id, mission_number: mission.mission_number, plate: mission.vehicle_plate,
      brand: mission.vehicle_brand, model: mission.vehicle_model, vin: mission.vehicle_vin,
    } : null,
    preview: status === 'pending' && mission ? await buildPreview(sb, mission, tok.kind) : null,
  })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const tok = await loadToken(sb, params.token)
  if (!tok) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const status = tokenStatus(tok)
  if (status !== 'pending') {
    return NextResponse.json({ error: status === 'used' ? 'Ce lien a déjà été utilisé. Refais un QR depuis la fiche.' : 'Lien expiré (15 min). Refais un QR depuis la fiche.' }, { status: 410 })
  }
  const missionId = tok.mission_id
  const now = new Date().toISOString()
  const { data: mission } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, source, parc_zone_key')
    .eq('id', missionId).maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const { data: author } = tok.created_by
    ? await sb.from('users').select('id, name').eq('id', tok.created_by).maybeSingle()
    : { data: null }
  const authorName = author?.name || 'bureau'
  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: missionId, actor_id: tok.created_by || null, action, notes, metadata }).then(() => {}, () => {})
  const { data: controlRow } = await sb.from('mission_exit_control').select('*').eq('mission_id', missionId).maybeSingle()
  const patchControl = async (fields: Record<string, any>) => {
    if (!controlRow) return
    await sb.from('mission_exit_control').update({ ...fields, updated_at: now }).eq('mission_id', missionId)
  }

  // ── Signature → attestation figée ──────────────────────────────────────────
  if (tok.kind === 'signature') {
    const body = await req.json().catch(() => ({})) as { signature?: string; signer_name?: string }
    const m = /^data:image\/png;base64,(.+)$/.exec(String(body.signature || ''))
    if (!m) return NextResponse.json({ error: 'Signature manquante.' }, { status: 400 })
    if (!controlRow) return NextResponse.json({ error: 'Cette fiche n\'est pas soumise au contrôle de sortie.' }, { status: 409 })
    if (!controlRow.identity) return NextResponse.json({ error: 'Identité de la personne présente non enregistrée : à faire avant la signature.' }, { status: 409 })
    if (!controlRow.path || controlRow.path === 'assistance') return NextResponse.json({ error: 'Chemin de sortie à choisir avant la signature.' }, { status: 409 })
    if (controlRow.path === 'informex' && !controlRow.informex_qr_raw) return NextResponse.json({ error: 'Bon Informex à scanner avant la signature.' }, { status: 409 })
    if (controlRow.identity_role === 'transporter' && !controlRow.cmr) return NextResponse.json({ error: 'CMR à photographier avant la signature.' }, { status: 409 })

    const png = Buffer.from(m[1], 'base64')
    const path = `${missionId}/signature/${Date.now()}_signature.png`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: false })
    if (upErr) return NextResponse.json({ error: `Stockage signature : ${upErr.message}` }, { status: 500 })
    await sb.from('mission_documents').insert({
      mission_id: missionId, kind: 'signature', file_path: path, file_name: 'signature.png',
      mime_type: 'image/png', file_size: png.length, capture_token: tok.id, uploaded_by: tok.created_by || null,
    })
    const signerName = String(body.signer_name || '').trim()
      || [controlRow.identity?.firstName, controlRow.identity?.lastName].filter(Boolean).join(' ')
    const attestation = {
      signed_at: now, signer_name: signerName, released_by: authorName,
      vehicle: {
        plate: mission.vehicle_plate, vin: mission.vehicle_vin, brand: mission.vehicle_brand, model: mission.vehicle_model,
        mission_number: mission.mission_number, external_id: mission.external_id, dossier_number: mission.dossier_number,
        zone: mission.parc_zone_key,
      },
      expert_bureau: controlRow.expert_bureau, armed_at: controlRow.armed_at,
      path: controlRow.path, path_destination: controlRow.path_destination,
      path_chosen_by: controlRow.path_chosen_by_name, path_note: controlRow.path_note,
      informex: controlRow.informex_doc || null, informex_qr_raw: controlRow.informex_qr_raw || null,
      informex_match: controlRow.informex_match || null,
      identity: controlRow.identity, identity_role: controlRow.identity_role, mandate_note: controlRow.mandate_note,
      company: controlRow.company || null, cmr: controlRow.cmr || null,
    }
    await patchControl({ attestation, attestation_signed_at: now, attestation_signature_path: path, attestation_by: tok.created_by || null })
    await sb.from('capture_tokens').update({ used_at: now }).eq('id', tok.id)
    await log('exit_control_signed', `✍️ Attestation d'enlèvement signée sur le téléphone par ${signerName || 'la personne présente'} (${roleLabel(controlRow.identity_role)}) — remise par ${authorName}.`, { signer_name: signerName })
    await sb.from('mission_remarks').insert({
      mission_id: missionId, created_by: tok.created_by || null,
      text: `✍️ Attestation d'enlèvement signée par ${signerName || '—'} (${roleLabel(controlRow.identity_role)}) — chemin ${controlRow.path === 'informex' ? 'Informex' : `autre sortie → ${controlRow.path_destination || '—'}`}.`,
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, kind: 'signature' })
  }

  // ── Photos → stockage + lecture ───────────────────────────────────────────
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Envoi invalide.' }, { status: 400 })
  const files = (form.getAll('files') as File[]).filter(f => f && typeof f === 'object' && f.size > 0)
  const qrRaw = String(form.get('qr_raw') || '').trim()
  if (!files.length && !(tok.kind === 'informex' && qrRaw)) {
    return NextResponse.json({ error: 'Aucune photo reçue.' }, { status: 400 })
  }

  const stored: { id: string; path: string }[] = []
  const ocrImages: { base64: string; mimeType: string }[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const buf = Buffer.from(await f.arrayBuffer())
    const ext = (f.type === 'image/png') ? 'png' : (f.type === 'image/webp') ? 'webp' : 'jpg'
    const path = `${missionId}/${tok.kind}/${Date.now()}_${i + 1}.${ext}`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: f.type || 'image/jpeg', upsert: false })
    if (upErr) return NextResponse.json({ error: `Stockage photo : ${upErr.message}` }, { status: 500 })
    const { data: doc } = await sb.from('mission_documents').insert({
      mission_id: missionId, kind: tok.kind, file_path: path, file_name: f.name || `${tok.kind}_${i + 1}.${ext}`,
      mime_type: f.type || 'image/jpeg', file_size: f.size, capture_token: tok.id, uploaded_by: tok.created_by || null,
    }).select('id').single()
    if (doc) stored.push({ id: doc.id, path })
    if (ocrImages.length < MAX_OCR_IMAGES) {
      try {
        const small = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
        ocrImages.push({ base64: small.toString('base64'), mimeType: 'image/jpeg' })
      } catch { ocrImages.push({ base64: buf.toString('base64'), mimeType: f.type || 'image/jpeg' }) }
    }
  }

  let ocr: any = null
  let ocrError: string | null = null
  if (ocrImages.length) {
    const prompt = tok.kind === 'id_card' ? ID_DOCUMENT_PROMPT : tok.kind === 'cmr' ? CMR_PROMPT : INFORMEX_PROMPT
    const ask = tok.kind === 'id_card' ? 'Lis cette pièce d\'identité et retourne uniquement le JSON.'
              : tok.kind === 'cmr' ? 'Lis ce CMR et retourne uniquement le JSON.'
              : 'Lis ce bon Informex et retourne uniquement le JSON.'
    try {
      const r = await extractJsonFromImages(ocrImages, prompt, ask)
      if (r.ok) ocr = r.data; else ocrError = r.error
    } catch (e: any) { ocrError = e?.message || 'Lecture échouée' }
  }
  if (stored[0]) {
    await sb.from('mission_documents').update({ ocr, qr_raw: qrRaw || null }).eq('id', stored[0].id)
  }

  // ── Alimente le contrôle de sortie ────────────────────────────────────────
  let result: any = { ocr, ocr_error: ocrError, qr_raw: qrRaw || null }
  if (tok.kind === 'id_card') {
    if (ocr && (ocr.firstName || ocr.lastName) && !controlRow?.attestation_signed_at) {
      const identity = {
        firstName: ocr.firstName || null, lastName: ocr.lastName || null, birthDate: ocr.birthDate || null,
        nationality: ocr.nationality || null, documentNumber: ocr.documentNumber || null, documentType: ocr.documentType || null,
        country: ocr.country || null, street: ocr.street || null, zip: ocr.zip || null, city: ocr.city || null,
        source: 'ocr', confidence: ocr.confidence || null,
      }
      await patchControl({ identity, identity_at: now, identity_by: tok.created_by || null, identity_role: controlRow?.identity_role || 'buyer' })
      await log('exit_control_identity', `🪪 Pièce d'identité photographiée et lue : ${[identity.firstName, identity.lastName].filter(Boolean).join(' ')}${identity.nationality ? ` (${identity.nationality})` : ''} — confiance ${identity.confidence || '?'} (par ${authorName}).`, { source: 'ocr', confidence: identity.confidence })
    } else {
      await log('exit_control_identity', `🪪 Pièce d'identité photographiée (${files.length}) — lecture ${ocr ? 'incomplète' : 'impossible'}${ocrError ? ` : ${ocrError}` : ''}. À encoder à la main sur la fiche.`, { source: 'ocr', ok: false })
    }
  } else if (tok.kind === 'cmr') {
    if (!controlRow?.attestation_signed_at) {
      await patchControl({ cmr: ocr || { confidence: 'low', photos_only: true }, cmr_at: now, cmr_by: tok.created_by || null })
    }
    await log('exit_control_cmr', `📄 CMR photographié (${files.length})${ocr?.cmrNumber ? ` — n° ${ocr.cmrNumber}` : ''}${ocr?.carrier ? ` — transporteur ${ocr.carrier}` : ''}${ocr?.truckPlate ? ` — camion ${ocr.truckPlate}` : ''} (par ${authorName}).`, { ocr_ok: !!ocr })
  } else if (tok.kind === 'informex') {
    const match = ocr ? informexMatch(ocr, mission) : null
    result.match = match
    if (!controlRow?.attestation_signed_at) {
      const fields: any = { informex_doc: ocr || controlRow?.informex_doc || null, informex_match: match }
      if (qrRaw) { fields.informex_qr_raw = qrRaw; fields.informex_qr_at = now; fields.informex_qr_by = tok.created_by || null }
      await patchControl(fields)
    }
    const warn = match && (match.plate === false || match.vin === false) ? ' ⚠️ DISCORDANCE avec la fiche !' : ''
    await log('exit_control_informex', `📋 Bon Informex ${qrRaw ? 'scanné (QR décodé)' : 'photographié SANS QR'}${ocr?.reference ? ` — réf. ${ocr.reference}` : ''}${ocr?.buyerName ? ` — acheteur ${ocr.buyerName}` : ''}${match ? ` — plaque ${match.plate === null ? '?' : match.plate ? 'OK' : 'KO'} / châssis ${match.vin === null ? '?' : match.vin ? 'OK' : 'KO'}` : ''}${warn} (par ${authorName}).`, { qr_raw: qrRaw || null, match })
  }

  await sb.from('capture_tokens').update({ used_at: now }).eq('id', tok.id)
  return NextResponse.json({ ok: true, kind: tok.kind, documents: stored.map(s => s.id), ...result })
}

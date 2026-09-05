// src/app/api/capture/[token]/route.ts
//
// Capture depuis le téléphone (page /capture/[token], PUBLIQUE : le jeton
// à usage unique tient lieu d'accès — il a été créé depuis la fiche par un
// utilisateur connecté, qui reste l'auteur des pièces et dont le PIN sert
// à passer une étape).
//
// Deux familles de jetons :
//   - 'id_card' | 'cmr' | 'informex' | 'signature' : UNE pièce, jeton consommé
//     à l'envoi (boutons unitaires de la fiche).
//   - 'restitution' : la PROCÉDURE COMPLÈTE enchaînée sur le téléphone (un
//     seul QR) : chemin → bon Informex → identité → CMR → attestation. Chaque
//     étape est passable avec motif + PIN. Le jeton est consommé à la fin
//     (attestation signée ou passée, ou chemin assistance).
//
// GET  → { status, kind, mission, preview }
// POST → multipart (files[] + step? + qr_raw? + role? …) pour les photos
//        JSON { step, ... } pour path / assistance / identity / role /
//        informex_qr / skip / signature / finish
// Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import sharp                 from 'sharp'
import bcrypt                from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { extractJsonFromImages, ID_DOCUMENT_PROMPT, CMR_PROMPT, INFORMEX_PROMPT } from '@/lib/ocr/vision-json'
import { getExitControlState, informexMatch, computeChecks, EXIT_STEP_LABELS, type ExitStep } from '@/lib/missions/exit-control'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'mission-documents'
const MAX_OCR_IMAGES = 3
const PHOTO_KINDS = ['id_card', 'cmr', 'informex'] as const
type PhotoKind = typeof PHOTO_KINDS[number]

async function loadToken(sb: any, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data } = await sb.from('capture_tokens')
    .select('id, mission_id, kind, created_by, expires_at, used_at').eq('id', token).maybeSingle()
  return data || null
}
const tokenStatus = (t: any) =>
  t.used_at ? 'used' : new Date(t.expires_at).getTime() < Date.now() ? 'expired' : 'pending'

const roleLabel = (r?: string | null) => r === 'mandate' ? 'mandataire de l\'acheteur' : r === 'transporter' ? 'transporteur' : 'acheteur'
const json = (b: any, status = 200) => NextResponse.json(b, { status })

async function buildPreview(sb: any, missionId: string) {
  const state = await getExitControlState(sb, missionId)
  const c = state.control || {}
  return {
    armed:         state.armed,
    allowed:       state.allowed,
    expert_bureau: c.expert_bureau || null,
    path:          c.path || null,
    destination:   c.path_destination || null,
    path_note:     c.path_note || null,
    path_by:       c.path_chosen_by_name || null,
    informex:      c.informex_doc ? { reference: c.informex_doc.reference || null, buyerName: c.informex_doc.buyerName || null } : null,
    informex_qr:   !!c.informex_qr_raw,
    informex_match: c.informex_match || null,
    identity:      c.identity || null,
    identity_role: c.identity_role || null,
    mandate_note:  c.mandate_note || null,
    company:       c.company || null,
    cmr:           c.cmr ? { cmrNumber: c.cmr.cmrNumber || null, carrier: c.cmr.carrier || null, truckPlate: c.cmr.truckPlate || null } : null,
    signed:        !!c.attestation_signed_at,
    skips:         c.skips || {},
    checks:        state.checks,
    requires:      state.requires,
    missing:       state.reason,
  }
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const tok = await loadToken(sb, params.token)
  if (!tok) return json({ status: 'expired', error: 'Lien invalide' }, 404)
  const { data: mission } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, source')
    .eq('id', tok.mission_id).maybeSingle()
  const status = tokenStatus(tok)
  const wantsPreview = tok.kind === 'signature' || tok.kind === 'restitution'
  return json({
    status, kind: tok.kind,
    mission: mission ? {
      id: mission.id, mission_number: mission.mission_number, plate: mission.vehicle_plate,
      brand: mission.vehicle_brand, model: mission.vehicle_model, vin: mission.vehicle_vin,
    } : null,
    preview: status === 'pending' && mission && wantsPreview ? await buildPreview(sb, mission.id) : null,
  })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const tok = await loadToken(sb, params.token)
  if (!tok) return json({ error: 'Lien invalide' }, 404)
  const status = tokenStatus(tok)
  if (status !== 'pending') {
    return json({ error: status === 'used' ? 'Ce lien a déjà été utilisé. Refais un QR depuis la fiche.' : 'Lien expiré. Refais un QR depuis la fiche.' }, 410)
  }
  const missionId = tok.mission_id
  const now = new Date().toISOString()
  const isRestitution = tok.kind === 'restitution'

  const { data: mission } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, source, parc_zone_key')
    .eq('id', missionId).maybeSingle()
  if (!mission) return json({ error: 'Mission introuvable' }, 404)
  const mv = mission as NonNullable<typeof mission>   // non-null dans les closures
  const { data: author } = tok.created_by
    ? await sb.from('users').select('id, name, verify_pin_hash').eq('id', tok.created_by).maybeSingle()
    : { data: null }
  const authorName = author?.name || 'bureau'

  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: missionId, actor_id: tok.created_by || null, action, notes, metadata }).then(() => {}, () => {})
  const remark = (text: string) =>
    sb.from('mission_remarks').insert({ mission_id: missionId, created_by: tok.created_by || null, text }).then(() => {}, () => {})
  const reloadControl = async () => (await sb.from('mission_exit_control').select('*').eq('mission_id', missionId).maybeSingle()).data
  let control = await reloadControl()
  const patchControl = async (fields: Record<string, any>) => {
    if (!control) return
    await sb.from('mission_exit_control').update({ ...fields, updated_at: now }).eq('mission_id', missionId)
    control = await reloadControl()
  }
  const markUsed = () => sb.from('capture_tokens').update({ used_at: now }).eq('id', tok.id)
  const respond = async (extra: any = {}) => json({ ok: true, ...extra, preview: isRestitution ? await buildPreview(sb, missionId) : undefined })

  // ── Lecture du corps : JSON ou multipart ──────────────────────────────────
  const ctype = req.headers.get('content-type') || ''
  let body: any = {}
  let form: FormData | null = null
  if (ctype.includes('multipart/form-data')) {
    form = await req.formData().catch(() => null)
    if (!form) return json({ error: 'Envoi invalide.' }, 400)
  } else {
    body = await req.json().catch(() => ({}))
  }
  const field = (k: string) => (form ? String(form.get(k) ?? '') : String(body[k] ?? '')).trim()
  const step: string = isRestitution ? (field('step') || (form ? '' : 'signature')) : tok.kind
  if (isRestitution && !control) return json({ error: 'Cette fiche n\'est pas soumise au contrôle de sortie.' }, 409)
  if (control?.attestation_signed_at && step !== 'finish') return json({ error: 'Attestation déjà signée : la procédure est terminée.' }, 409)

  // ── Photos → stockage + lecture ───────────────────────────────────────────
  async function handlePhotos(kind: PhotoKind) {
    const files = form ? (form.getAll('files') as File[]).filter(f => f && typeof f === 'object' && f.size > 0) : []
    const qrRaw = field('qr_raw')
    if (!files.length && !(kind === 'informex' && qrRaw)) return json({ error: 'Aucune photo reçue.' }, 400)

    const stored: { id: string; path: string }[] = []
    const ocrImages: { base64: string; mimeType: string }[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const buf = Buffer.from(await f.arrayBuffer())
      const ext = (f.type === 'image/png') ? 'png' : (f.type === 'image/webp') ? 'webp' : 'jpg'
      const path = `${missionId}/${kind}/${Date.now()}_${i + 1}.${ext}`
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: f.type || 'image/jpeg', upsert: false })
      if (upErr) return json({ error: `Stockage photo : ${upErr.message}` }, 500)
      const { data: doc } = await sb.from('mission_documents').insert({
        mission_id: missionId, kind, file_path: path, file_name: f.name || `${kind}_${i + 1}.${ext}`,
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
      const prompt = kind === 'id_card' ? ID_DOCUMENT_PROMPT : kind === 'cmr' ? CMR_PROMPT : INFORMEX_PROMPT
      const ask = kind === 'id_card' ? 'Lis cette pièce d\'identité et retourne uniquement le JSON.'
                : kind === 'cmr' ? 'Lis ce CMR et retourne uniquement le JSON.'
                : 'Lis ce bon Informex et retourne uniquement le JSON.'
      try {
        const r = await extractJsonFromImages(ocrImages, prompt, ask)
        if (r.ok) ocr = r.data; else ocrError = r.error
      } catch (e: any) { ocrError = e?.message || 'Lecture échouée' }
    }
    if (stored[0]) await sb.from('mission_documents').update({ ocr, qr_raw: qrRaw || null }).eq('id', stored[0].id)

    const result: any = { ocr, ocr_error: ocrError, qr_raw: qrRaw || null }
    if (kind === 'id_card') {
      const role = ['buyer', 'mandate', 'transporter'].includes(field('role')) ? field('role') : (control?.identity_role || 'buyer')
      let company: any = control?.company || null
      try { if (field('company')) company = JSON.parse(field('company')) } catch {}
      const mandateNote = field('mandate_note') || control?.mandate_note || null
      if (ocr && (ocr.firstName || ocr.lastName)) {
        const identity = {
          firstName: ocr.firstName || null, lastName: ocr.lastName || null, birthDate: ocr.birthDate || null,
          nationality: ocr.nationality || null, documentNumber: ocr.documentNumber || null, documentType: ocr.documentType || null,
          country: ocr.country || null, street: ocr.street || null, zip: ocr.zip || null, city: ocr.city || null,
          source: 'ocr', confidence: ocr.confidence || null,
        }
        await patchControl({ identity, identity_at: now, identity_by: tok.created_by || null, identity_role: role, mandate_note: mandateNote, company })
        await log('exit_control_identity', `🪪 Pièce d'identité photographiée et lue : ${[identity.firstName, identity.lastName].filter(Boolean).join(' ')}${identity.nationality ? ` (${identity.nationality})` : ''} — ${roleLabel(role)} — confiance ${identity.confidence || '?'} (par ${authorName}).`, { source: 'ocr', role, confidence: identity.confidence })
      } else {
        await patchControl({ identity_role: role, mandate_note: mandateNote, company })
        await log('exit_control_identity', `🪪 Pièce d'identité photographiée (${files.length}) — lecture ${ocr ? 'incomplète' : 'impossible'}${ocrError ? ` : ${ocrError}` : ''}. Identité à encoder à la main.`, { source: 'ocr', ok: false })
        result.needs_manual = true
      }
    } else if (kind === 'cmr') {
      await patchControl({ cmr: ocr || { confidence: 'low', photos_only: true }, cmr_at: now, cmr_by: tok.created_by || null })
      await log('exit_control_cmr', `📄 CMR photographié (${files.length})${ocr?.cmrNumber ? ` — n° ${ocr.cmrNumber}` : ''}${ocr?.carrier ? ` — transporteur ${ocr.carrier}` : ''}${ocr?.truckPlate ? ` — camion ${ocr.truckPlate}` : ''} (par ${authorName}).`, { ocr_ok: !!ocr })
    } else {
      const match = ocr ? informexMatch(ocr, mv) : null
      result.match = match
      const fields: any = { informex_doc: ocr || control?.informex_doc || null, informex_match: match }
      if (qrRaw) { fields.informex_qr_raw = qrRaw; fields.informex_qr_at = now; fields.informex_qr_by = tok.created_by || null }
      await patchControl(fields)
      const warn = match && (match.plate === false || match.vin === false) ? ' ⚠️ DISCORDANCE avec la fiche !' : ''
      await log('exit_control_informex', `📋 Bon Informex ${qrRaw ? 'scanné (QR décodé)' : 'photographié SANS QR'}${ocr?.reference ? ` — réf. ${ocr.reference}` : ''}${ocr?.buyerName ? ` — acheteur ${ocr.buyerName}` : ''}${match ? ` — plaque ${match.plate === null ? '?' : match.plate ? 'OK' : 'KO'} / châssis ${match.vin === null ? '?' : match.vin ? 'OK' : 'KO'}` : ''}${warn} (par ${authorName}).`, { qr_raw: qrRaw || null, match })
    }
    if (!isRestitution) await markUsed()
    return respond({ kind, documents: stored.map(s => s.id), ...result })
  }

  // ── Signature → attestation figée ─────────────────────────────────────────
  async function handleSignature() {
    const m = /^data:image\/png;base64,(.+)$/.exec(String(body.signature || ''))
    if (!m) return json({ error: 'Signature manquante.' }, 400)
    if (!control) return json({ error: 'Cette fiche n\'est pas soumise au contrôle de sortie.' }, 409)
    const { checks } = computeChecks(control)
    if (!checks.path)     return json({ error: 'Chemin de sortie à choisir (ou à passer) avant la signature.' }, 409)
    if (control.path === 'assistance') return json({ error: 'Reprise par une assistance : pas d\'attestation à signer.' }, 409)
    if (!checks.informex) return json({ error: 'Bon Informex à scanner (ou à passer) avant la signature.' }, 409)
    if (!checks.identity) return json({ error: 'Identité de la personne présente à enregistrer (ou à passer) avant la signature.' }, 409)
    if (!checks.cmr)      return json({ error: 'CMR à photographier (ou à passer) avant la signature.' }, 409)

    const png = Buffer.from(m[1], 'base64')
    const path = `${missionId}/signature/${Date.now()}_signature.png`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: false })
    if (upErr) return json({ error: `Stockage signature : ${upErr.message}` }, 500)
    await sb.from('mission_documents').insert({
      mission_id: missionId, kind: 'signature', file_path: path, file_name: 'signature.png',
      mime_type: 'image/png', file_size: png.length, capture_token: tok.id, uploaded_by: tok.created_by || null,
    })
    const signerName = String(body.signer_name || '').trim()
      || [control.identity?.firstName, control.identity?.lastName].filter(Boolean).join(' ')
    const attestation = {
      signed_at: now, signer_name: signerName, released_by: authorName,
      vehicle: {
        plate: mv.vehicle_plate, vin: mv.vehicle_vin, brand: mv.vehicle_brand, model: mv.vehicle_model,
        mission_number: mv.mission_number, external_id: mv.external_id, dossier_number: mv.dossier_number,
        zone: mv.parc_zone_key,
      },
      expert_bureau: control.expert_bureau, armed_at: control.armed_at,
      path: control.path, path_destination: control.path_destination,
      path_chosen_by: control.path_chosen_by_name, path_note: control.path_note,
      informex: control.informex_doc || null, informex_qr_raw: control.informex_qr_raw || null,
      informex_match: control.informex_match || null,
      identity: control.identity, identity_role: control.identity_role, mandate_note: control.mandate_note,
      company: control.company || null, cmr: control.cmr || null,
      skips: control.skips || {},
    }
    await patchControl({ attestation, attestation_signed_at: now, attestation_signature_path: path, attestation_by: tok.created_by || null })
    await markUsed()
    await log('exit_control_signed', `✍️ Attestation d'enlèvement signée sur le téléphone par ${signerName || 'la personne présente'} (${roleLabel(control?.identity_role)}) — remise par ${authorName}.`, { signer_name: signerName })
    await remark(`✍️ Attestation d'enlèvement signée par ${signerName || '—'} (${roleLabel(control?.identity_role)}) — chemin ${control?.path === 'informex' ? 'Informex' : `autre sortie → ${control?.path_destination || '—'}`}.`)
    return respond({ kind: 'signature' })
  }

  // ── Étape passée : motif + PIN de celui qui a ouvert le QR ────────────────
  async function handleSkip() {
    const which = String(body.which || '') as ExitStep
    if (!EXIT_STEP_LABELS[which]) return json({ error: 'Étape inconnue.' }, 400)
    const reason = String(body.reason || '').trim()
    const pin = String(body.pin || '').trim()
    if (reason.length < 5) return json({ error: 'Motif obligatoire (5 caractères minimum).' }, 400)
    if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN à 4 chiffres requis.' }, 400)
    if (!author?.verify_pin_hash) return json({ error: `Aucun PIN configuré pour ${authorName}. À définir dans Mon Profil.` }, 400)
    const ok = await bcrypt.compare(pin, author.verify_pin_hash)
    if (!ok) {
      await log('exit_control_skip_denied', `⛔ Étape « ${EXIT_STEP_LABELS[which]} » : passage refusé, PIN incorrect (${authorName}). Motif annoncé : ${reason}`, { step: which, reason })
      return json({ error: 'PIN incorrect.' }, 403)
    }
    const skips = { ...(control?.skips || {}), [which]: { reason, by: tok.created_by || null, by_name: authorName, at: now } }
    await patchControl({ skips })
    await log('exit_control_step_skipped', `⚠️ Étape PASSÉE « ${EXIT_STEP_LABELS[which]} » par ${authorName} (PIN validé) — motif : ${reason}`, { step: which, reason })
    await remark(`⚠️ Contrôle de sortie : étape « ${EXIT_STEP_LABELS[which]} » passée par ${authorName} — motif : ${reason}`)
    // Passer l'attestation termine la procédure.
    if (which === 'attestation' && isRestitution) await markUsed()
    return respond({ skipped: which })
  }

  // ── Chemin / identité / rôle / QR manuel / fin (JSON, procédure complète) ─
  async function handlePath() {
    const path = body.path === 'informex' ? 'informex' : body.path === 'autre' ? 'autre' : body.path === 'assistance' ? 'assistance' : null
    if (!path) return json({ error: 'Chemin invalide.' }, 400)
    const byName = String(body.by_name || '').trim()
    const destination = String(body.destination || '').trim()
    const note = String(body.note || '').trim()
    if (path !== 'assistance' && !byName) return json({ error: 'Indique qui, au bureau d\'expertise, a donné l\'instruction.' }, 400)
    if (path === 'autre' && !destination) return json({ error: 'Destination requise pour une autre sortie.' }, 400)
    if (path === 'assistance' && !note) return json({ error: 'Indique l\'assistance et la référence du dossier.' }, 400)
    await patchControl({
      path, path_destination: path === 'autre' ? destination : null, path_chosen_at: now,
      path_chosen_by_kind: 'staff', path_chosen_by_name: path === 'assistance' ? authorName : byName,
      path_chosen_by_user: tok.created_by || null, path_note: note || null, assistance_mission_id: null,
    })
    await log('exit_control_path', `Chemin de sortie (téléphone) : ${path === 'informex' ? 'Informex' : path === 'autre' ? `autre sortie → ${destination}` : `reprise par une assistance — ${note}`}${byName ? ` — sur instruction de ${byName}` : ''} (par ${authorName}).`, { path, destination, by_name: byName, note })
    return respond({ path })
  }
  async function handleIdentity() {
    const id = body.identity && typeof body.identity === 'object' ? body.identity : {}
    const role = ['buyer', 'mandate', 'transporter'].includes(body.role) ? body.role : (control?.identity_role || 'buyer')
    const fields: any = { identity_role: role, mandate_note: String(body.mandate_note || '').trim() || null }
    if (body.company && typeof body.company === 'object') fields.company = { name: body.company.name || null, vat: body.company.vat || null, truck_plate: body.company.truck_plate || null }
    if (id.firstName || id.lastName) {
      fields.identity = {
        firstName: id.firstName || null, lastName: id.lastName || null, birthDate: id.birthDate || null,
        nationality: id.nationality || null, documentNumber: id.documentNumber || null, documentType: id.documentType || null,
        country: id.country || null, street: id.street || null, zip: id.zip || null, city: id.city || null,
        phone: id.phone || null, source: 'manual',
      }
      fields.identity_at = now; fields.identity_by = tok.created_by || null
    } else if (!control?.identity) {
      return json({ error: 'Nom ou prénom requis.' }, 400)
    }
    await patchControl(fields)
    await log('exit_control_identity', `Identité ${fields.identity ? 'saisie sur le téléphone' : 'mise à jour'} : ${[control?.identity?.firstName, control?.identity?.lastName].filter(Boolean).join(' ')} — ${roleLabel(role)}${fields.mandate_note ? ` — mandat : ${fields.mandate_note}` : ''} (par ${authorName}).`, { role, source: fields.identity ? 'manual' : undefined })
    return respond({ role })
  }
  async function handleInformexQr() {
    const raw = String(body.raw || '').trim()
    if (!raw) return json({ error: 'Contenu du QR / référence requis.' }, 400)
    await patchControl({ informex_qr_raw: raw, informex_qr_at: now, informex_qr_by: tok.created_by || null })
    await log('exit_control_informex', `📋 Bon Informex : QR / référence encodé sur le téléphone par ${authorName} : ${raw.slice(0, 200)}`, { raw, manual: true })
    return respond({ raw })
  }
  async function handleFinish() {
    // Chemin assistance : pas d'attestation, la procédure se termine ici.
    if (!control) return json({ error: 'Cette fiche n\'est pas soumise au contrôle de sortie.' }, 409)
    const state = await getExitControlState(sb, missionId)
    if (!state.allowed) return json({ error: state.reason || 'Procédure incomplète.' }, 409)
    await markUsed()
    return respond({ finished: true })
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  if (!isRestitution) {
    if (tok.kind === 'signature') return handleSignature()
    return handlePhotos(tok.kind as PhotoKind)
  }
  switch (step) {
    case 'id_card': case 'cmr': case 'informex': return handlePhotos(step)
    case 'path':        return handlePath()
    case 'identity':    return handleIdentity()
    case 'informex_qr': return handleInformexQr()
    case 'skip':        return handleSkip()
    case 'signature':   return handleSignature()
    case 'finish':      return handleFinish()
    default:            return json({ error: `Étape inconnue : ${step}` }, 400)
  }
}

// src/lib/requisitoire/attach.ts
//
// Rattache un document capturé (ligne requisitoire_intake) à une fiche mission.
// Réutilise la logique d'annexion manuelle (remarque + PJ bucket mission-remarks
// + colonnes dédiées). Branche selon doc_type :
//   - requisitoire  → colonnes requisitoire_* + CONCATÈNE le n° de PV dans
//                     dossier_number (jamais d'écrasement).
//   - levee_saisie  → colonnes levee_saisie_* + police_levee_saisie_ok=true
//                     (lève le blocage police ; la date pilote le gardiennage).
//
// Le document (PDF ou capture HTML du mail) est déjà dans le bucket
// 'mission-remarks' (préfixe _intake) : on le référence tel quel.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { requisitoireIncidentAt, provisionalPlate, type RequisitoireExtract } from './extract'
import { moveMessageToFolder, AUTO_MANAGED_FOLDER } from './graph'
import { isRequisitoireDoc } from './doc'

export interface AttachOptions {
  leveeDate?: string                       // YYYY-MM-DD (override UI)
  leveeType?: 'definitive' | 'temporaire'  // override UI
}


/**
 * Ce qu'un document (réquisitoire ou levée) apprend à une fiche.
 *
 * Extrait de `attachRequisitoire` le 2026-08-19 pour être partagé avec le SCAN
 * depuis la fiche : un document scanné au comptoir doit compléter la fiche
 * exactement comme le même document arrivé par mail. Deux chemins, un seul
 * calcul — sinon ils divergent au premier correctif.
 */
export function buildMissionUpdateFromExtract(
  mission: { dossier_number?: string | null; vehicle_plate?: string | null; vehicle_vin?: string | null; incident_at?: string | null },
  ex: RequisitoireExtract,
  opts: { docPath?: string | null; actorId?: string | null; isLevee: boolean; leveeDate?: string; leveeType?: 'definitive' | 'temporaire'; note?: string | null },
): { update: Record<string, any>; dateAdapted: boolean } {
  const update: Record<string, any> = {}
  let dateAdapted = false

  if (opts.isLevee) {
    update.levee_saisie_at        = new Date().toISOString()
    update.levee_saisie_date      = opts.leveeDate || ex.levee_date
    update.levee_saisie_type      = opts.leveeType || ex.levee_type || 'definitive'
    update.levee_saisie_note      = ex.autorite || null
    update.levee_saisie_doc_path  = opts.docPath || null
    update.levee_saisie_by        = opts.actorId || null
    update.police_levee_saisie_ok = true
  } else {
    const pv = (ex.pv_number || '').trim()
    const noteBits = [ex.autorite && `Autorité : ${ex.autorite}`, pv && `PV : ${pv}`].filter(Boolean).join(' · ')
    update.requisitoire_at       = new Date().toISOString()
    update.requisitoire_note     = opts.note || noteBits || null
    update.requisitoire_doc_path = opts.docPath || null
    update.requisitoire_by       = opts.actorId || null
    if (pv) {
      const current = (mission.dossier_number || '').trim()
      if (!current) update.dossier_number = pv
      else if (!current.split(/\s*\/\s*/).map((s: string) => s.trim()).includes(pv)) {
        update.dossier_number = `${current} / ${pv}`
      }
    }
    const reqAt = requisitoireIncidentAt(ex)
    if (reqAt) {
      const cur = mission.incident_at ? new Date(mission.incident_at).getTime() : null
      if (cur === null || Math.abs(cur - new Date(reqAt).getTime()) > 60_000) {
        update.incident_at = reqAt
        update.intervention_date = reqAt
        dateAdapted = true
      }
    }
  }

  // Plaque / VIN : présent et absent chez nous -> on remplit ; présent mais
  // DIFFÉRENT -> on concatène. Jamais d'écrasement.
  const normCmp = (v: string) => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const mergeField = (current: string | null | undefined, incoming: string | null): string | undefined => {
    const inc = (incoming || '').trim()
    if (!inc) return undefined
    const cur = (current || '').trim()
    if (!cur) return inc
    const parts = cur.split(/\s*\/\s*/).map(normCmp)
    if (parts.includes(normCmp(inc))) return undefined
    return `${cur} / ${inc}`
  }
  const incomingPlate = ex.plaque
    || ((mission.vehicle_plate || '').trim() ? null : provisionalPlate(ex.marque, ex.vin))
  const plateUpd = mergeField(mission.vehicle_plate, incomingPlate)
  const vinUpd   = mergeField(mission.vehicle_vin, ex.vin)
  if (plateUpd !== undefined) update.vehicle_plate = plateUpd
  if (vinUpd   !== undefined) update.vehicle_vin   = vinUpd

  return { update, dateAdapted }
}

export async function attachRequisitoire(
  sb: any,
  intakeId: string,
  missionId: string,
  actorId: string | null,
  opts: AttachOptions = {},
): Promise<{ ok: true; mailMoved: boolean; mailMoveError?: string; dateAdapted: boolean } | { ok: false; error: string }> {
  const { data: intake, error: iErr } = await sb
    .from('requisitoire_intake').select('*').eq('id', intakeId).maybeSingle()
  if (iErr)     return { ok: false, error: iErr.message }
  if (!intake)  return { ok: false, error: 'Document introuvable' }
  if (intake.status === 'attached') return { ok: false, error: 'Déjà rattaché' }

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions').select('id, dossier_number, vehicle_plate, vehicle_vin, incident_at').eq('id', missionId).maybeSingle()
  if (mErr)     return { ok: false, error: mErr.message }
  if (!mission) return { ok: false, error: 'Fiche introuvable' }

  const ex = (intake.extracted || {}) as RequisitoireExtract
  const isLevee = intake.doc_type === 'levee_saisie'
  let dateAdapted = false

  // Un réquisitoire est un DOCUMENT (PDF / JPG). La capture HTML d'un mail ne
  // vaut que pour une levée (preuve du corps du mail). Olivier 2026-09-03.
  if (!isLevee && !isRequisitoireDoc(intake.doc_path)) {
    return { ok: false, error: 'Ce mail n\'a pas de réquisitoire en pièce jointe (PDF ou JPG) — une capture de mail ne peut pas être rattachée comme réquisitoire.' }
  }

  // ── Validation spécifique levée : date obligatoire (pilote le gardiennage) ──
  const leveeDate = (opts.leveeDate || ex.levee_date || '').trim()
  const leveeType = (opts.leveeType || ex.levee_type || 'definitive') as 'definitive' | 'temporaire'
  if (isLevee) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leveeDate)) {
      return { ok: false, error: 'Date de levée requise (AAAA-MM-JJ) avant de lever la saisie.' }
    }
  }

  // ── Remarque de traçabilité (porte la PJ) ──────────────────────────────────
  let remarkText: string
  if (isLevee) {
    const typeLabel = leveeType === 'definitive' ? 'définitive' : 'temporaire'
    remarkText = `🔓 Levée de saisie ${typeLabel} (date : ${leveeDate.split('-').reverse().join('/')}) — capture auto${ex.autorite ? ` · ${ex.autorite}` : ''}`
  } else {
    const pv = (ex.pv_number || '').trim()
    const noteBits = [ex.autorite && `Autorité : ${ex.autorite}`, pv && `PV : ${pv}`].filter(Boolean).join(' · ')
    remarkText = `📋 Réquisitoire annexé (capture auto)${noteBits ? ` — ${noteBits}` : ''}`
  }

  const { data: remark, error: rErr } = await sb
    .from('mission_remarks').insert({ mission_id: missionId, text: remarkText, created_by: actorId }).select().single()
  if (rErr) return { ok: false, error: rErr.message }

  if (intake.doc_path) {
    await sb.from('mission_remark_attachments').insert({
      remark_id:   remark.id,
      file_path:   intake.doc_path,
      file_name:   intake.file_name || (isLevee ? 'levee.html' : 'requisitoire.pdf'),
      mime_type:   intake.file_name?.endsWith('.html') ? 'text/html' : 'application/pdf',
      uploaded_by: actorId,
    })
  }

  // ── Écritures sur la fiche (même calcul que le scan depuis la fiche) ───────
  const built = buildMissionUpdateFromExtract(mission, ex, {
    docPath: intake.doc_path, actorId, isLevee, leveeDate, leveeType,
  })
  const update = built.update
  dateAdapted = built.dateAdapted

  const { error: uErr } = await sb.from('incoming_missions').update(update).eq('id', missionId)
  if (uErr) return { ok: false, error: uErr.message }

  // ── Marquer rattaché + déplacer le mail source ─────────────────────────────
  const { error: sErr } = await sb.from('requisitoire_intake').update({
    status: 'attached', matched_mission_id: missionId,
    attached_at: new Date().toISOString(), attached_by: actorId,
  }).eq('id', intakeId)
  if (sErr) return { ok: false, error: sErr.message }

  let mailMoved = false
  let mailMoveError: string | undefined
  if (intake.mailbox && intake.source_email_id) {
    const mv = await moveMessageToFolder(intake.mailbox, intake.source_email_id, AUTO_MANAGED_FOLDER)
      .catch((e: any) => ({ ok: false, error: e?.message }))
    mailMoved = mv.ok
    mailMoveError = mv.error
  }

  return { ok: true, mailMoved, mailMoveError, dateAdapted }
}

// src/lib/requisitoire/attach.ts
//
// Rattache un réquisitoire capturé (ligne requisitoire_intake) à une fiche
// mission choisie. Réutilise la logique d'annexion manuelle
// (/api/missions/[id]/requisitoire) : remarque de traçabilité + pièce jointe +
// colonnes requisitoire_*. En plus : CONCATÈNE le n° de PV dans dossier_number
// (jamais d'écrasement — règle Olivier 2026-07-01).
//
// Le PDF est déjà stocké dans le bucket 'mission-remarks' (préfixe _intake) : on
// le référence tel quel (même bucket → download OK), pas de copie.
//
// Cf [[project_assistant_mail_module]].

import type { RequisitoireExtract } from './extract'

export async function attachRequisitoire(
  sb: any,
  intakeId: string,
  missionId: string,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Ligne d'intake.
  const { data: intake, error: iErr } = await sb
    .from('requisitoire_intake').select('*').eq('id', intakeId).maybeSingle()
  if (iErr)     return { ok: false, error: iErr.message }
  if (!intake)  return { ok: false, error: 'Réquisitoire introuvable' }
  if (intake.status === 'attached') return { ok: false, error: 'Déjà rattaché' }

  // 2. Fiche cible.
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions').select('id, dossier_number').eq('id', missionId).maybeSingle()
  if (mErr)     return { ok: false, error: mErr.message }
  if (!mission) return { ok: false, error: 'Fiche introuvable' }

  const ex = (intake.extracted || {}) as RequisitoireExtract
  const pv = (ex.pv_number || '').trim()

  // 3. Remarque de traçabilité (porte la PJ + apparaît dans la timeline).
  const noteBits = [ex.autorite && `Autorité : ${ex.autorite}`, pv && `PV : ${pv}`].filter(Boolean).join(' · ')
  const remarkText = `📋 Réquisitoire annexé (capture auto)${noteBits ? ` — ${noteBits}` : ''}`
  const { data: remark, error: rErr } = await sb
    .from('mission_remarks').insert({ mission_id: missionId, text: remarkText, created_by: actorId }).select().single()
  if (rErr) return { ok: false, error: rErr.message }

  // 4. Pièce jointe (référence le PDF déjà stocké).
  if (intake.doc_path) {
    await sb.from('mission_remark_attachments').insert({
      remark_id:   remark.id,
      file_path:   intake.doc_path,
      file_name:   intake.file_name || 'requisitoire.pdf',
      mime_type:   'application/pdf',
      uploaded_by: actorId,
    })
  }

  // 5. Concaténer le PV dans dossier_number (jamais écraser).
  let dossierUpdate: Record<string, any> = {}
  if (pv) {
    const current = (mission.dossier_number || '').trim()
    if (!current) dossierUpdate.dossier_number = pv
    else if (!current.split(/\s*\/\s*/).map((s: string) => s.trim()).includes(pv)) {
      dossierUpdate.dossier_number = `${current} / ${pv}`
    }
  }

  // 6. Colonnes workflow réquisitoire sur la fiche.
  const { error: uErr } = await sb.from('incoming_missions').update({
    requisitoire_at:       new Date().toISOString(),
    requisitoire_note:     noteBits || null,
    requisitoire_doc_path: intake.doc_path || null,
    requisitoire_by:       actorId,
    ...dossierUpdate,
  }).eq('id', missionId)
  if (uErr) return { ok: false, error: uErr.message }

  // 7. Marquer la ligne d'intake rattachée.
  const { error: sErr } = await sb.from('requisitoire_intake').update({
    status: 'attached', matched_mission_id: missionId,
    attached_at: new Date().toISOString(), attached_by: actorId,
  }).eq('id', intakeId)
  if (sErr) return { ok: false, error: sErr.message }

  return { ok: true }
}

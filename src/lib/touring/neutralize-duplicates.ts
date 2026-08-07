// src/lib/touring/neutralize-duplicates.ts
//
// Gestion des affectations Touring multiples sur un MÊME dossier.
//
// Touring peut, sur un dossier déjà traité, renvoyer :
//   • un VRAI DOUBLON de ré-affectation (même action, nouveau n° d'affectation) →
//     on le neutralise (status='ignored'). Risque nul : un `new` ne peut pas être
//     plus avancé qu'une vraie mission.
//   • une ACTION DE SUIVI (CID_SEQ_ACTION incrémenté, IS_FIRST_ACTION=0 : complément
//     REM + demande VR, destination résolue…) → on la FUSIONNE dans la fiche du
//     chauffeur (le raw_content passe sur le seq de suivi = tracking actif, l'ancien
//     seq est conservé dans touring_actions), pour que le chauffeur puisse la
//     clôturer et que le cron VR la scrute. Olivier 2026-08-07.

import { mapComexVr } from './vr'

const HANDLED = ['assigned', 'accepted', 'in_progress', 'delivering', 'parked', 'to_invoice', 'completed', 'invoiced']

function parseRaw(raw: string | null): any {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}
const seqOf = (r: any) => Number(String(r?.CID_SEQ_ACTION || '').trim()) || 0

// Destination résolue depuis les champs TO_ d'une action (garage de dépose).
// null si non résolue (ex. "CHECK ADDRESS" sans code postal) → on ne touche pas.
function destFromRaw(r: any): Record<string, any> | null {
  const cp = String(r?.TO_CP || '').trim()
  const nom = String(r?.TO_NOM || '').trim()
  if (!cp) return null   // pas encore résolu
  const addr = [
    [String(r?.TO_RUE || '').trim(), String(r?.TO_NUM_RUE || '').trim()].filter(Boolean).join(' '),
    [cp, String(r?.TO_LOC || '').trim()].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  const patch: Record<string, any> = {}
  if (nom) patch.destination_name = nom
  if (addr) patch.destination_address = addr
  const lat = Number(r?.TO_LATITUDE), lng = Number(r?.TO_LONGITUDE)
  if (Number.isFinite(lat) && lat) patch.destination_lat = lat
  if (Number.isFinite(lng) && lng) patch.destination_lng = lng
  return Object.keys(patch).length ? patch : null
}

export async function neutralizeTouringDuplicates(sb: any): Promise<{ ignored: number; merged: number; refs: string[] }> {
  const { data: news } = await sb.from('incoming_missions')
    .select('id, mission_number, dossier_number, external_id, raw_content')
    .eq('source', 'touring').eq('status', 'new')

  const refs: string[] = []
  let ignored = 0, merged = 0
  const now = new Date().toISOString()

  for (const n of (news || [])) {
    if (!n.dossier_number) continue
    // Fiche sœur (même dossier) en statut AVANCÉ.
    const { data: sibs } = await sb.from('incoming_missions')
      .select('id, mission_number, raw_content, touring_actions, status, external_id')
      .eq('source', 'touring').eq('dossier_number', n.dossier_number)
      .neq('id', n.id).in('status', HANDLED)
      .order('created_at', { ascending: true })
    const sibling = (sibs || [])[0]
    if (!sibling) continue

    const nRaw = parseRaw(n.raw_content)
    const sRaw = parseRaw(sibling.raw_content)
    const nSeq = seqOf(nRaw), sSeq = seqOf(sRaw)
    const isFollowup = nSeq > sSeq && Number(nRaw?.IS_FIRST_ACTION) === 0

    // Déjà fusionnée (la sœur porte déjà ce seq) → simple neutralisation.
    const alreadyMerged = sSeq === nSeq

    if (isFollowup && !alreadyMerged) {
      // FUSION : la fiche chauffeur bascule son tracking actif sur le seq de suivi.
      const actions: any[] = Array.isArray(sibling.touring_actions) && sibling.touring_actions.length
        ? [...sibling.touring_actions]
        : [{ seq: String(sSeq), external_id: sibling.external_id, role: 'first', received_at: null, raw: sibling.raw_content }]
      if (!actions.some(a => String(a.seq) === String(nSeq))) {
        actions.push({ seq: String(nSeq), external_id: n.external_id, role: 'followup', received_at: now, raw: n.raw_content })
      }
      const patch: Record<string, any> = {
        raw_content:     n.raw_content,               // seq de suivi = actif (clôture/scan VR)
        touring_actions: actions,
        touring_vr:      mapComexVr(nRaw),
        updated_at:      now,
      }
      const dest = destFromRaw(nRaw)
      if (dest) Object.assign(patch, dest)            // destination résolue (garage)

      const { error: eu } = await sb.from('incoming_missions').update(patch).eq('id', sibling.id)
      if (eu) continue
      await sb.from('incoming_missions')
        .update({ status: 'ignored', parent_mission_id: sibling.id, updated_at: now }).eq('id', n.id)
      await sb.from('mission_logs').insert({
        mission_id: sibling.id, action: 'touring_followup_merged',
        notes: `Action de suivi Touring (seq ${nSeq}, dossier ${n.dossier_number}) fusionnée dans la fiche : tracking actif ${sSeq}→${nSeq}${dest ? ', destination mise à jour' : ''}.`,
        metadata: { from_seq: String(sSeq), to_seq: String(nSeq), followup_mission_number: n.mission_number, dossier: n.dossier_number, auto: true },
      }).then(() => {}, () => {})
      merged++
      refs.push(`#${n.mission_number}→#${sibling.mission_number}`)
      continue
    }

    // Sinon : vrai doublon de ré-affectation → neutralisation (comportement d'origine).
    const { error } = await sb.from('incoming_missions')
      .update({ status: 'ignored', updated_at: now }).eq('id', n.id)
    if (error) continue
    ignored++
    refs.push(`#${n.mission_number}`)
    await sb.from('mission_logs').insert({
      mission_id: n.id, action: 'ignored',
      notes: `Doublon d'affectation Touring (dossier ${n.dossier_number} déjà traité) — neutralisée automatiquement`,
      metadata: { dedup_dossier: true, auto: true },
    }).then(() => {}, () => {})
  }

  return { ignored, merged, refs }
}

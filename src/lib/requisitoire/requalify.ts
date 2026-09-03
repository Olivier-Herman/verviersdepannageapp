// src/lib/requisitoire/requalify.ts
//
// REQUALIFICATION DE LA SOURCE d'après le MOTIF coché sur le réquisitoire
// (Olivier 2026-09-03). Le chauffeur encode « Saisie » sur place, mais la
// procédure de facturation dépend du formulaire de police :
//   • réquisitoire ADMINISTRATIF, case « Abandon voie publique » → police_avp
//   • réquisitoire ADMINISTRATIF, case « Stationnement »         → police_mg (Mal garée)
//   • réquisitoire JUDICIAIRE (non-assurance, accident, vol…)     → reste police_saisie
// Un dossier AVP / Mal garée ne passe PAS par le Parquet : le dossier saisie
// éventuel est retiré (ou clôturé si un état de frais est déjà parti, à traiter
// à la main). Appelé au rattachement (mail, scan fiche) et par le rattrapage.

import type { RequisitoireExtract } from './extract'

export const SOURCE_BY_MOTIF: Partial<Record<NonNullable<RequisitoireExtract['motif']>, string>> = {
  abandon_voie_publique: 'police_avp',
  stationnement:         'police_mg',
}
const SOURCE_LABEL: Record<string, string> = { police_avp: 'Police AVP (abandon voie publique)', police_mg: 'Police Mal garée', police_saisie: 'Police Saisie' }
const MOTIF_LABEL: Record<string, string> = { abandon_voie_publique: 'Abandon voie publique', stationnement: 'Stationnement' }

/** Source cible d'après le motif coché, ou null si le motif ne change rien. */
export function sourceForMotif(ex: Pick<RequisitoireExtract, 'motif' | 'form_kind'> | null | undefined): string | null {
  if (!ex?.motif) return null
  // Les motifs administratifs n'existent que sur le formulaire administratif ;
  // si le lecteur dit « judiciaire » avec un motif administratif, on ne bouge pas.
  if (ex.form_kind === 'judiciaire') return null
  return SOURCE_BY_MOTIF[ex.motif] || null
}

export interface RequalifyResult {
  changed: boolean
  from?: string
  to?: string
  motif?: string
  dossierAction?: 'removed' | 'closed_ef_sent' | 'none'
  reason?: string
}

/**
 * Applique la requalification sur une fiche « police_saisie » si le motif
 * l'impose. Idempotent : ne fait rien si la source est déjà la bonne.
 */
export async function requalifySourceFromRequisitoire(
  sb: any, missionId: string, ex: RequisitoireExtract | null | undefined,
  opts: { actorId?: string | null; origin: string; dryRun?: boolean } ,
): Promise<RequalifyResult> {
  const target = sourceForMotif(ex)
  if (!target) return { changed: false, reason: 'motif sans incidence' }
  const { data: m } = await sb.from('incoming_missions').select('id, source, vehicle_plate, mission_number').eq('id', missionId).maybeSingle()
  if (!m) return { changed: false, reason: 'fiche introuvable' }
  if (m.source !== 'police_saisie') return { changed: false, reason: `source ${m.source} (pas une saisie)` }
  if (m.source === target) return { changed: false, reason: 'déjà bonne source' }

  const motif = ex!.motif as string
  const note = `Source « Police Saisie » → « ${SOURCE_LABEL[target] || target} » : case « ${MOTIF_LABEL[motif] || motif} » cochée sur le réquisitoire administratif (${opts.origin}).`

  // Dossier saisie lié ?
  let dossierAction: RequalifyResult['dossierAction'] = 'none'
  const { data: d } = await sb.from('saisie_dossiers').select('id, ef_number, state').eq('mission_id', missionId).maybeSingle()
  if (opts.dryRun) return { changed: true, from: m.source, to: target, motif, dossierAction: d ? (d.ef_number ? 'closed_ef_sent' : 'removed') : 'none' }

  const { error } = await sb.from('incoming_missions').update({ source: target }).eq('id', missionId)
  if (error) return { changed: false, reason: error.message }
  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: opts.actorId || null, action: 'source_requalified', notes: note,
    metadata: { source: 'requisitoire_motif', from: m.source, to: target, motif, origin: opts.origin },
  }).then(() => {}, () => {})
  await sb.from('mission_remarks').insert({ mission_id: missionId, text: `🔀 ${note}`, created_by: opts.actorId || null }).then(() => {}, () => {})

  if (d) {
    if (!d.ef_number) {
      await sb.from('saisie_dossiers').delete().eq('id', d.id)
      dossierAction = 'removed'
    } else {
      await sb.from('saisie_dossiers').update({
        state: 'clos', pending_action: null, pending_action_at: null, updated_at: new Date().toISOString(),
        notes: `⚠ REQUALIFIÉ ${SOURCE_LABEL[target] || target} (motif « ${MOTIF_LABEL[motif] || motif} ») alors qu'un état de frais ${d.ef_number} est déjà parti au Parquet — à régulariser à la main.`,
      }).eq('id', d.id)
      dossierAction = 'closed_ef_sent'
    }
  }
  return { changed: true, from: m.source, to: target, motif, dossierAction }
}

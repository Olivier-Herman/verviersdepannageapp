// src/lib/axa/close-bg.ts
//
// Clôture AXA go&assist en arrière-plan, déclenchée quand le chauffeur clôture
// dans VD Soft (completed / park / complete_delivery). Même patron que Kaze
// (advanceKazeMissionForAction) et Touring (accept-bg) : best-effort, waitUntil,
// jamais bloquant pour le chauffeur. Olivier 2026-08-11.
//
// Deux temps :
//   1. `closeMissionAuto` déroule la séquence d'intervention restante jusqu'à
//      Completed — en respectant l'ordre imposé et le type de service (les étapes
//      de remorquage ne sont jouées que si la mission les prévoit). On lui passe
//      nos VRAIS horodatages : sans ça toutes les étapes tombent à la même
//      seconde et la mission ressemble à un bypass à vide chez AXA.
//   2. `postReport(..., { isSendingToAxa: true })` SOLDE la mission. Sans ce
//      rapport final elle reste ouverte côté AXA même quand toutes les étapes
//      sont pointées.
//
// Garde-fou connu : go&assist répond souvent 200 avec `{isSuccess:false}` — le
// client le traduit déjà en `ok:false`, on journalise le message tel quel.

import { closeMissionAuto, postReport, getMission, postInterventionStep, reportMovementForNothing } from '@/lib/axa/goassist'

export interface AxaCloseBgResult {
  ok: boolean
  steps?: Array<{ step: string; ok: boolean; message?: string }>
  reported?: boolean
  error?: string
}

/**
 * Identifiant go&assist de la mission. Deux formats coexistent en vrai :
 *   • numérique — « 11000820 » (fiches créées par le poll AXA) ;
 *   • alphanumérique — « AXP0097-RBND4I3 » (vu le 2026-08-12 sur une fiche
 *     rattachée). Exiger des chiffres seuls écartait donc de VRAIES missions.
 *
 * ⚠️ À l'inverse, toutes les fiches `source='axa'` n'ont pas d'identifiant chez
 * eux : les relivraisons créées chez nous portent un external_id INTERNE
 * (« REL-ACC-db5e6fb3 », « REL-10729317 »). Les pousser reviendrait à interroger
 * go&assist avec un identifiant fantôme — on ne déclenche rien.
 *
 * ⚠️ La SOURCE de cet identifiant est la colonne `axa_mission_order_id` quand
 * elle existe : sur une fiche rattachée (mail parsé puis lié au poll),
 * `external_id` porte le n° de dossier du mail, pas l'identifiant go&assist.
 */
export function axaMissionOrderId(id: string | null | undefined): string | null {
  const v = String(id || '').trim()
  if (!v || v.length < 6) return null
  if (/^REL[-_]/i.test(v)) return null            // relivraison créée chez nous
  if (!/^[A-Z0-9][A-Z0-9._-]{4,}$/i.test(v)) return null
  return v
}

/**
 * Rapport final. On part du rapport DÉJÀ présent chez AXA (echo-and-fill) plutôt
 * que d'inventer un objet : on ne remplit que ce qu'on connaît, le reste garde
 * les valeurs de la mission. Schéma imbriqué imposé par leur API.
 */
function buildReport(axaMission: any, m: any): any {
  const base = axaMission?.report ? JSON.parse(JSON.stringify(axaMission.report)) : {}

  const arrival = m.on_site_at || m.on_way_at || null
  const problemLabel = m.panne_motif_label || m.incident_description || null
  const problemCode  = m.panne_motif || null

  base.missionStatement = {
    ...(base.missionStatement || {}),
    ...(arrival ? { actualArrivalTime: new Date(arrival).toISOString().replace('Z', '+00:00') } : {}),
  }

  base.case = {
    ...(base.case || {}),
    problemContext: {
      ...(base.case?.problemContext || {}),
      ...(problemCode  ? { problemCode }        : {}),
      ...(problemLabel ? { problemDescription: String(problemLabel).slice(0, 500) } : {}),
    },
  }

  // Personne rencontrée sur place : chez nous c'est `client_name` (la personne
  // présente), pas le payeur — cf sémantique VD Soft.
  if (m.client_name) {
    base.personOnSite = {
      ...(base.personOnSite || {}),
      name:  m.client_name,
      ...(m.client_phone ? { phoneNumber: m.client_phone } : {}),
    }
  }

  // Distances : on ne renvoie que ce qu'on a réellement mesuré.
  const towed = Number(m.snc_km_total ?? 0)
  if (Number.isFinite(towed) && towed > 0) {
    base.distances = { ...(base.distances || {}), towedDistance: towed }
  }

  return base
}

export async function closeAxaBg(
  missionId: string,
  missionOrderId: string,
  actorId: string | null,
  sb: any,
): Promise<AxaCloseBgResult> {
  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: missionId, actor_id: actorId, action, notes, metadata })
      .then(() => {}, () => {})

  try {
    const { data: m } = await sb.from('incoming_missions')
      .select('id, mission_type, on_way_at, on_site_at, loaded_at, completed_at, delivering_at, client_name, client_phone, ' +
              'incident_description, panne_motif, panne_motif_label, snc_km_total, axa_closed_at')
      .eq('id', missionId).maybeSingle()

    if (m?.axa_closed_at) { await log('axa_synced', 'AXA : déjà clôturée, on ne rejoue pas', {}); return { ok: true } }

    // Nos pointages → étapes go&assist. `Started` = le début de l'intervention sur
    // place ; `DestinationAddress` et la fin suivent le chargement / la livraison.
    const iso = (v: any) => v ? new Date(v).toISOString().replace('Z', '+00:00') : undefined
    const end = iso(m?.completed_at) || iso(m?.delivering_at) || undefined
    const executedAt: Record<string, string | undefined> = {
      OnTheRoad:          iso(m?.on_way_at),
      OnSite:             iso(m?.on_site_at),
      VehicleDamages:     iso(m?.on_site_at),
      Started:            iso(m?.on_site_at),
      DestinationAddress: iso(m?.loaded_at) || end,
      VehicleDamages_2:   end,
      Signed_1:           end,
      Signed_2:           end,
      Completed:          end,
    }

    // ── TRAJET À VIDE : AXA a annulé APRÈS le départ du chauffeur ─────────────
    // La fiche est conservée (mission_type='trajet_vide', lien go&assist intact)
    // par reconcileAxaCancellations, pour être clôturée normalement AVEC ses
    // pointages. Chez AXA ce n'est PAS une intervention : on ne déroule pas la
    // séquence complète (pas de Started/Signed/Completed sur une mission que
    // personne n'a réalisée) — on pousse ce qu'on a vraiment fait, puis l'étape
    // `MovementForNothing`. Olivier 2026-08-11.
    if (String(m?.mission_type || '') === 'trajet_vide') {
      const ga = await getMission(missionOrderId)
      const available: string[] = ga?.configuration?.interventionStepConfiguration?.availableSteps || []
      const last: string | null = ga?.lastInterventionStatus || null
      const done = new Set<string>(last ? [last] : [])
      const steps: Array<{ step: string; ok: boolean; message?: string }> = []

      // Pointages réels, uniquement s'ils existent ET ne sont pas déjà passés.
      for (const [step, at] of [['OnTheRoad', executedAt.OnTheRoad], ['OnSite', executedAt.OnSite]] as const) {
        if (!at || done.has(step) || (available.length > 0 && !available.includes(step))) continue
        const rs = await postInterventionStep(missionOrderId, step, { executedAt: at })
        steps.push({ step, ok: rs.ok, message: rs.data?.message })
        if (!rs.ok) {
          await log('axa_sync_error', `AXA (trajet à vide) : échec à ${step} — ${rs.data?.message || rs.status}`,
            { steps, availableSteps: available, lastInterventionStatus: last })
          return { ok: false, steps, error: `échec à ${step}` }
        }
      }

      // L'étape terminale. `end` = l'heure de clôture chez nous quand on l'a ;
      // sinon le helper pointe à l'instant présent.
      const mfn = end
        ? await postInterventionStep(missionOrderId, 'MovementForNothing', { executedAt: end })
        : await reportMovementForNothing(missionOrderId)
      steps.push({ step: 'MovementForNothing', ok: mfn.ok, message: mfn.data?.message })

      if (!mfn.ok) {
        await log('axa_sync_error',
          `AXA (trajet à vide) : MovementForNothing refusé — ${mfn.data?.message || mfn.status}`,
          { steps, availableSteps: available, lastInterventionStatus: last, response: mfn.data })
        return { ok: false, steps, error: 'MovementForNothing refusé' }
      }

      await sb.from('incoming_missions')
        .update({ axa_closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', missionId).then(() => {}, () => {})

      // ⚠️ À VALIDER au premier cas réel : go&assist attend-il en plus un rapport
      // final (isSendingToAxa) sur un trajet à vide ? On ne l'envoie PAS tant
      // qu'on ne l'a pas vu — un rapport d'intervention sur une mission non
      // réalisée serait faux. Les métadonnées ci-dessous donnent la réponse
      // (séquence acceptée, étapes disponibles) dès la première mission.
      await log('axa_synced',
        `AXA : trajet à vide déclaré (${steps.map(s => s.step).join(' → ')}) — rapport final non envoyé (à valider)`,
        { steps, availableSteps: available, lastInterventionStatus: last, movementForNothing: true })

      return { ok: true, steps, reported: false }
    }

    const r = await closeMissionAuto(missionOrderId, { executedAt })
    if (!r.ok) {
      await log('axa_sync_error', `AXA : séquence interrompue — ${r.error || 'raison inconnue'}`, { steps: r.steps })
      return { ok: false, steps: r.steps, error: r.error }
    }

    // Rapport final : c'est LUI qui solde la mission chez AXA.
    let reported = false
    try {
      const axaMission = await getMission(missionOrderId)
      const rep = await postReport(missionOrderId, buildReport(axaMission, m || {}), { isSendingToAxa: true })
      reported = rep.ok
      if (!rep.ok) await log('axa_sync_error', `AXA : étapes OK mais rapport refusé — ${rep.data?.message || rep.status}`, { report: rep.data })
    } catch (e: any) {
      await log('axa_sync_error', `AXA : étapes OK mais rapport en erreur — ${e?.message || e}`, {})
    }

    if (reported) {
      await sb.from('incoming_missions')
        .update({ axa_closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', missionId).then(() => {}, () => {})
    }

    await log('axa_synced',
      reported
        ? `AXA : mission clôturée et soldée (${r.steps.map(s => s.step).join(' → ')})`
        : `AXA : étapes pointées (${r.steps.map(s => s.step).join(' → ')}) — rapport final à renvoyer`,
      { steps: r.steps, reported })

    return { ok: true, steps: r.steps, reported }
  } catch (e: any) {
    await log('axa_sync_error', `AXA : erreur pendant la clôture — ${e?.message || e}`, {})
    return { ok: false, error: e?.message || String(e) }
  }
}

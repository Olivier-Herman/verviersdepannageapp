// src/lib/missions/snc-dpr-request.ts
//
// SNC — CLIENT PARTI = DÉPLACEMENT POUR RIEN (Olivier 26/10/2026).
// « Pour SNC il faut prévoir une option DPR quand le chauffeur arrive et que le client est parti. Il n'y a donc
// pas de paiement, c'est une annulation de mission. » + « le DPR envoie une demande de validation au dispatch avec
// signature par code PIN » + « ce type de DPR en SNC doit créer une clôture sans facturation ».
// Le chauffeur DEMANDE depuis la fiche ; tous les dispatchers (+ admin/superadmin) reçoivent un popup OBLIGATOIRE
// (même mécanique que siabis-couvert-request) ; le premier qui répond décide, la validation est signée par SON code
// PIN. Validé → clôture chez Touring avec le code de fin 20 « Le client est parti avant mon arrivée », mission
// clôturée SANS FACTURATION (completed + no_charge, jamais to_invoice), rien à encaisser. Refusé → le chauffeur continue la mission. Le chauffeur est prévenu dans les deux cas.

import bcrypt from 'bcryptjs'
import { sendNotification, sendNotificationToRoles } from '@/lib/notifications/send'
import { parseComexKeys, transformTouring } from '@/lib/cloture/transform/touring'
import { enqueueClose, isRetryable } from '@/lib/cloture/queue'

const DPR_CODE = '20'
const DPR_LABEL = 'Le client est parti avant mon arrivée'

export async function requestSncDpr(sb: any, missionId: string, driverId: string, remarque?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, vehicle_plate, vehicle_brand, vehicle_model, incident_city, incident_address, on_way_at, on_site_at, loaded_at, snc_dpr_requested_at, snc_dpr_decided_at')
    .eq('id', missionId).maybeSingle()
  if (!m) return { ok: false, error: 'Fiche introuvable' }
  if (m.source !== 'police_snc') return { ok: false, error: 'Réservé aux missions Siabis non couvertes' }
  if (['cancelled', 'completed', 'to_invoice', 'invoiced'].includes(String(m.status))) return { ok: false, error: 'La mission est déjà terminée' }
  if (m.loaded_at) return { ok: false, error: 'Le véhicule est déjà chargé : ce n\'est plus un déplacement pour rien' }
  if (!m.on_way_at && !m.on_site_at) return { ok: false, error: 'Passe d\'abord « En route »' }
  const pending = m.snc_dpr_requested_at && (!m.snc_dpr_decided_at || m.snc_dpr_decided_at < m.snc_dpr_requested_at)
  if (pending) return { ok: false, error: 'Demande déjà envoyée au dispatch — en attente de réponse' }

  const { data: driver } = await sb.from('users').select('name').eq('id', driverId).maybeSingle()
  const now = new Date().toISOString()
  const group = `dpr-${missionId}-${Date.now()}`
  const note = String(remarque || '').trim().slice(0, 300) || null
  await sb.from('incoming_missions').update({ snc_dpr_requested_at: now, snc_dpr_requested_by: driverId, snc_dpr_decision: null }).eq('id', missionId)
  await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: driverId, action: 'snc_dpr_requested', notes: `Le chauffeur signale que le client est parti (déplacement pour rien) — validation dispatch demandée${note ? ` · « ${note} »` : ''}` }).then(() => {}, () => {})

  const vehicle = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'snc_dpr_request', {
    title: `${driver?.name || 'Un chauffeur'} : client parti — ${m.vehicle_plate || 'sans plaque'}`,
    body: `Fiche #${m.mission_number} · ${vehicle} · ${m.incident_city || m.incident_address || ''}. Déplacement pour rien : pas de paiement, clôture sans facturation. À valider avec ton code.`,
    mission_id: missionId,
    action_url: `/dispatch/${missionId}`,
    data: {
      modal: true, kind: 'snc_dpr', request_group: group, mission_id: missionId, mission_number: m.mission_number,
      plate: m.vehicle_plate, vehicle, city: m.incident_city || m.incident_address || null, driver_name: driver?.name || null,
      on_site_at: m.on_site_at || null, remarque: note,
    },
  })
  return { ok: true }
}

export async function decideSncDpr(sb: any, notifId: string, userId: string, decision: 'approve' | 'refuse', pin?: string | null): Promise<{ ok: boolean; error?: string; code?: string; already?: boolean; warning?: string }> {
  const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', notifId).eq('user_id', userId).maybeSingle()
  const d = n?.payload?.data || {}
  if (!n || n.notif_type !== 'snc_dpr_request' || !d.mission_id) return { ok: false, error: 'Notification inconnue' }

  // Signature : le code PIN personnel de celui qui décide (Olivier 26/10/2026).
  const { data: me } = await sb.from('users').select('id, name, verify_pin_hash').eq('id', userId).maybeSingle()
  if (!me?.verify_pin_hash) return { ok: false, code: 'no_pin', error: 'Aucun code personnel défini sur ton profil : demande-le à Mobi.' }
  if (!pin || !/^\d{4}$/.test(String(pin))) return { ok: false, code: 'pin_required', error: 'Tape ton code à 4 chiffres pour signer.' }
  if (!(await bcrypt.compare(String(pin), me.verify_pin_hash))) return { ok: false, code: 'pin_invalid', error: 'Code incorrect.' }

  const now = new Date().toISOString()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, assigned_to, raw_content, loaded_at, snc_dpr_requested_at, snc_dpr_decided_at')
    .eq('id', d.mission_id).maybeSingle()
  if (!m) return { ok: false, error: 'Fiche introuvable' }
  const closeGroup = async () => {
    if (d.request_group) {
      await sb.from('notifications_log').update({ responded_at: now, read_at: now })
        .eq('notif_type', 'snc_dpr_request').is('responded_at', null).eq('payload->data->>request_group', d.request_group)
    } else {
      await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('id', notifId)
    }
  }
  // Le premier qui répond décide.
  const alreadyDecided = m.snc_dpr_decided_at && m.snc_dpr_requested_at && m.snc_dpr_decided_at >= m.snc_dpr_requested_at
  if (alreadyDecided) { await closeGroup(); return { ok: true, already: true } }
  if (decision === 'approve' && m.loaded_at) return { ok: false, error: 'Le véhicule a été chargé entre-temps : ce n\'est plus un déplacement pour rien. Refuse la demande.' }

  const upd: Record<string, unknown> = { snc_dpr_decision: decision === 'approve' ? 'approved' : 'refused', snc_dpr_decided_at: now, snc_dpr_decided_by: userId, updated_at: now }
  let warning: string | undefined
  if (decision === 'approve') {
    Object.assign(upd, {
      status: 'completed', completed_at: now, no_charge_at: now,
      no_charge_reason: `Déplacement pour rien : ${DPR_LABEL.toLowerCase()} (validé par ${me.name || 'le dispatch'})`,
      panne_motif: `dpr_${DPR_CODE}`, panne_motif_label: DPR_LABEL,
      amount_to_collect: null, awaiting_payment: false,
    })
  }
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', m.id)
  if (error) return { ok: false, error: error.message }
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: userId, action: decision === 'approve' ? 'snc_dpr_approved' : 'snc_dpr_refused',
    notes: decision === 'approve'
      ? `Déplacement pour rien validé et signé par code (${me.name || 'dispatch'}) — mission clôturée sans facturation`
      : `Déplacement pour rien refusé par ${me.name || 'le dispatch'} — le chauffeur continue la mission`,
  }).then(() => {}, () => {})
  await closeGroup()

  // Clôture chez Touring (dossier COMEX) avec le code de fin 20 ; plateforme injoignable → file de rattrapage.
  if (decision === 'approve') {
    const keys = parseComexKeys(m.raw_content)
    if (keys) {
      const input = { outcome: 'dpr' as const, dprCode: DPR_CODE, motifKey: null, prefill: null, vin: null, km: null, nonCouvert: true }
      try {
        let r: any = await transformTouring(keys, input as any)
        if (!r.ok && isRetryable(r.error)) {
          await enqueueClose({ missionId: m.id, assistance: 'touring', input: input as any, rawContent: m.raw_content, actorId: userId, error: r.error })
          r = { ...r, ok: true, queued: true }
        }
        await sb.from('mission_logs').insert({
          mission_id: m.id, actor_id: userId, action: r.ok ? (r.queued ? 'assistance_close_queued' : 'touring_closed') : 'assistance_close_error',
          notes: r.ok ? (r.queued ? 'Touring injoignable : clôture code 20 mise en file, rattrapage automatique' : `Clôture Touring — code ${DPR_CODE} (${DPR_LABEL})`) : `Clôture Touring KO — ${r.error || '?'} : à clôturer à la main`,
          metadata: { finCode: DPR_CODE, snc_dpr: true, ...(r.ok ? {} : { error: r.error }) },
        }).then(() => {}, () => {})
        if (!r.ok) warning = `Mission clôturée sans facturation, mais la clôture chez Touring a échoué (${r.error || 'erreur'}) : à clôturer à la main.`
      } catch (e: any) {
        warning = `Mission clôturée sans facturation, mais la clôture chez Touring a échoué (${e?.message || 'erreur'}) : à clôturer à la main.`
      }
    }
  }

  if (m.assigned_to) {
    await sendNotification(m.assigned_to, 'snc_dpr_decided', {
      title: decision === 'approve' ? `✅ Déplacement pour rien validé — #${m.mission_number}` : `⛔ Déplacement pour rien refusé — #${m.mission_number}`,
      body: decision === 'approve' ? 'Mission clôturée sans facturation par le dispatch : rien à encaisser, tu peux repartir.' : 'Le dispatch n\'a pas validé : appelle-le et continue la mission.',
      mission_id: m.id, action_url: `/mission/${m.id}`,
      data: { decision },
    }).catch(() => {})
  }
  return { ok: true, warning }
}

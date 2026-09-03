// src/lib/missions/parc-verification.ts
//
// VÉRIFICATION PHYSIQUE AU PARC (Olivier 2026-09-03) : avant d'engager une
// procédure sur un véhicule censé être en parc depuis longtemps (ex. mal garée
// → confirmation AVP au policier), on demande à un dispatcher de bureau de
// vérifier sur place qu'il est TOUJOURS LÀ. La demande = notification in-app
// de type `verification_parc` avec `data.modal = true` → popup BLOQUANT (pas de
// fermeture, pas de clic-fond) jusqu'à ce que chaque véhicule ait sa réponse
// « Présent » / « Absent ». La réponse est écrite sur la fiche
// (parc_verified_*), tracée en remarque, et les admins reçoivent le bilan.

import { sendNotification } from '@/lib/notifications/send'
import { sendNotificationToRoles } from '@/lib/notifications/send'

export interface ParcVerificationItem {
  mission_id: string
  plate: string
  vehicle: string
  days: number
  zone?: string | null
  context?: string | null   // ex. « mal garée depuis 92 j — passage AVP à confirmer »
}

const daysSince = (iso?: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0

/** Construit les items de vérification depuis des fiches. */
export function toVerificationItems(missions: any[], context?: (m: any) => string): ParcVerificationItem[] {
  return missions.map(m => ({
    mission_id: m.id,
    plate: m.vehicle_plate || 'sans plaque',
    vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—',
    days: daysSince(m.parked_at || m.received_at),
    zone: m.police_zone || null,
    context: context ? context(m) : null,
  }))
}

/**
 * Envoie la demande (popup bloquant) à un ou plusieurs utilisateurs.
 * `reason` = phrase d'intro affichée dans le popup.
 */
export async function requestParcVerification(
  sb: any, userIds: string[], items: ParcVerificationItem[], reason: string, opts?: { requestedBy?: string | null },
): Promise<{ sent: number }> {
  if (!items.length || !userIds.length) return { sent: 0 }
  let sent = 0
  for (const userId of userIds) {
    const r = await sendNotification(userId, 'verification_parc', {
      title: `Vérification au parc : ${items.length} véhicule${items.length > 1 ? 's' : ''}`,
      body: reason,
      action_url: '/fourriere',
      data: { modal: true, items, requested_by: opts?.requestedBy || null },
    })
    if (r?.ok) sent++
  }
  const now = new Date().toISOString()
  for (const it of items) {
    await sb.from('incoming_missions').update({ parc_check_asked_at: now }).eq('id', it.mission_id)
    await sb.from('mission_remarks').insert({ mission_id: it.mission_id, text: `🔍 Vérification de présence au parc demandée (popup bureau) — ${reason}` }).then(() => {}, () => {})
  }
  return { sent }
}

/**
 * Applique la réponse d'un dispatcher : { mission_id: 'present' | 'absent' }.
 * Écrit parc_verified_* sur chaque fiche, trace, et alerte les admins.
 */
export async function applyParcVerificationResponse(
  sb: any, notifId: string, userId: string, answers: Record<string, 'present' | 'absent'>,
): Promise<{ ok: boolean; error?: string; present: number; absent: number }> {
  const { data: notif } = await sb.from('notifications_log').select('id, user_id, notif_type, payload, responded_at').eq('id', notifId).eq('user_id', userId).maybeSingle()
  if (!notif) return { ok: false, error: 'Notification introuvable', present: 0, absent: 0 }
  if (notif.notif_type !== 'verification_parc') return { ok: false, error: 'Mauvais type', present: 0, absent: 0 }
  const items: ParcVerificationItem[] = notif.payload?.data?.items || []
  const { data: who } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  const now = new Date().toISOString()
  let present = 0, absent = 0
  const absentPlates: string[] = []
  for (const it of items) {
    const a = answers[it.mission_id]
    if (a !== 'present' && a !== 'absent') continue
    const isPresent = a === 'present'
    if (isPresent) present++; else { absent++; absentPlates.push(it.plate) }
    await sb.from('incoming_missions').update({ parc_verified_at: now, parc_verified_present: isPresent, parc_verified_by: userId }).eq('id', it.mission_id)
    await sb.from('mission_remarks').insert({
      mission_id: it.mission_id, created_by: userId,
      text: isPresent
        ? `✅ Présence au parc confirmée par ${who?.name || 'le bureau'} (vérification physique).`
        : `❌ VÉHICULE ABSENT DU PARC selon ${who?.name || 'le bureau'} (vérification physique) — à éclaircir : sorti sans clôture ? restitué ? déplacé ?`,
    }).then(() => {}, () => {})
    await sb.from('mission_logs').insert({
      mission_id: it.mission_id, actor_id: userId, action: 'parc_verification',
      notes: isPresent ? 'Présence au parc confirmée' : 'Véhicule ABSENT du parc', metadata: { notif_id: notifId },
    }).then(() => {}, () => {})
  }
  await sb.from('notifications_log').update({ responded_at: now, read_at: now, response: { answers } }).eq('id', notifId)

  await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
    title: `Vérification parc par ${who?.name || 'le bureau'} : ${present} présent(s)${absent ? `, ${absent} ABSENT(S)` : ''}`,
    body: absent ? `Absents : ${absentPlates.join(', ')} — fiches à éclaircir.` : 'Tous les véhicules demandés sont bien au parc.',
    action_url: '/fourriere',
  }).catch(() => {})
  return { ok: true, present, absent }
}

// src/lib/touring/resend-reactivate.ts — mission Touring renvoyée après un refus (Olivier 09/11/2026, 2KAP202).
//
// Touring retire une mission (refus, ou retrait de leurs listes) : cancel-detect annule la fiche sans frais.
// Il arrive que COMEX la renvoie 30-40 min plus tard sous le MÊME n° de commande ; on la retrouvait par ce n°
// et on se contentait de la « lier », annulée — la mission acceptée dans COMEX n'existait plus chez nous
// (pas de dispatch, pas de pointages vers Touring). Ici : si COMEX la présente de nouveau (pas clôturée, 07)
// et que l'annulation venait de cette détection automatique, la fiche revient — « à valider » si COMEX ne l'a
// pas encore acceptée, « acceptée, à attribuer » si elle l'est déjà. Une fiche annulée à la main n'est jamais
// réactivée.
import { withBrusselsOffset } from '@/lib/time/bxl-offset'

export async function reactiverSiRenvoyee(sb: any, opts: {
  missionId: string; statutComex: string; detail?: Record<string, any> | null; contenu?: Record<string, any>; dossier?: string | null
}): Promise<boolean> {
  const { data: m } = await sb.from('incoming_missions').select('id, status, cancelled_reason, vehicle_plate, mission_number, dossier_number').eq('id', opts.missionId).maybeSingle()
  if (!m || m.status !== 'cancelled' || String(opts.statutComex) === '07') return false
  // Dernière décision d'annulation : seulement la détection automatique Touring.
  const { data: logs } = await sb.from('mission_logs').select('action').eq('mission_id', m.id)
    .in('action', ['touring_cancelled_detected', 'cancel', 'cancelled', 'mission_cancelled', 'status_change', 'force_status', 'touring_resent_reactivated'])
    .order('created_at', { ascending: false }).limit(1)
  if (logs?.[0]?.action !== 'touring_cancelled_detected') return false

  const acceptee = String(opts.statutComex) === '04'
  const dAccept = String(opts.detail?.D_ACCEPT || '').slice(0, 19)
  const now = new Date().toISOString()
  const upd: Record<string, any> = {
    ...(opts.contenu || {}), status: acceptee ? 'dispatching' : 'new', cancelled_at: null, cancelled_reason: null,
    touring_missing_since: null, updated_at: now,
  }
  if (acceptee) upd.touring_accepted_at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dAccept) ? new Date(withBrusselsOffset(dAccept)).toISOString() : now
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', m.id).eq('status', 'cancelled')
  if (error) { console.warn('[touring] réactivation KO', m.id, error.message); return false }
  await sb.from('mission_logs').insert({
    mission_id: m.id, action: 'touring_resent_reactivated',
    notes: `Touring a renvoyé la mission (dossier ${opts.dossier || m.dossier_number || '—'}) après l'avoir retirée : fiche réactivée, ${acceptee ? 'déjà acceptée dans COMEX → à attribuer' : 'à valider'}.`,
    metadata: { statut_comex: opts.statutComex },
  }).then(() => {}, () => {})
  try {
    const { sendNotificationToRoles } = await import('@/lib/notifications/send')
    await sendNotificationToRoles(['admin', 'superadmin', 'dispatcher'], 'touring_cancelled', {
      title: `Touring a renvoyé ${m.vehicle_plate || 'une mission'}`,
      body: `La fiche #${m.mission_number ?? ''} annulée après le refus est réactivée : ${acceptee ? 'acceptée dans COMEX, à attribuer à un chauffeur' : 'à valider'}.`,
      action_url: `/dispatch/${m.id}`, mission_id: m.id,
    })
  } catch { /* jamais bloquant */ }
  return true
}

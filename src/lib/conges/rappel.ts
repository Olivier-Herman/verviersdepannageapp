// src/lib/conges/rappel.ts — demandes de congé en attente (Olivier 15/11/2026) : chaque jour ouvrable à 10 h 45, un écran
// s'ouvre chez Momo s'il reste des demandes à traiter, avec Valider / Refuser (signés par son code) et « Répondre plus
// tard » (le rappel revient le lendemain à 10 h 45). Rien en attente : aucun écran.
import { createAdminClient } from '@/lib/supabase'

export const CONGES_RAPPEL_TYPE = 'conges_en_attente'

export interface DemandeConge { id: string; worker: string; typeLabel: string; start: string; end: string; days: number | null; reason: string | null }

export async function demandesEnAttente(sb: any = createAdminClient()): Promise<DemandeConge[]> {
  const { CONGE_TYPES } = await import('@/lib/conges/apply')
  const { data: reqs } = await sb.from('conge_requests').select('id, personnel_id, type, start_date, end_date, days, reason').eq('status', 'pending').order('start_date')
  if (!reqs?.length) return []
  const ids = [...new Set(reqs.map((r: any) => r.personnel_id).filter(Boolean))]
  const { data: pers } = await sb.from('personnel').select('id, name').in('id', ids)
  const nom = new Map((pers || []).map((p: any) => [p.id, p.name]))
  return reqs.map((r: any) => ({ id: r.id, worker: String(nom.get(r.personnel_id) || '?'), typeLabel: (CONGE_TYPES as any)[r.type] || r.type, start: r.start_date, end: r.end_date, days: r.days ?? null, reason: r.reason || null }))
}

/** Rappel du jour : rien à faire → rien n'est envoyé. Un rappel encore ouvert d'hier est remplacé par celui du jour. */
export async function rappelerConges(): Promise<{ envoye: boolean; demandes: number; destinataires: number }> {
  const sb = createAdminClient()
  const demandes = await demandesEnAttente(sb)
  if (!demandes.length) return { envoye: false, demandes: 0, destinataires: 0 }
  const { getBusinessList } = await import('@/lib/settings/business')
  const ids = await getBusinessList('conges_rappel_user_ids')
  if (!ids.length) return { envoye: false, demandes: demandes.length, destinataires: 0 }
  const now = new Date().toISOString()
  await sb.from('notifications_log').update({ responded_at: now, read_at: now }).in('user_id', ids).eq('notif_type', CONGES_RAPPEL_TYPE).eq('channel', 'in_app').is('responded_at', null)
  const { sendNotificationToMany } = await import('@/lib/notifications/send')
  const n = demandes.length
  await sendNotificationToMany(ids, CONGES_RAPPEL_TYPE, {
    title: `${n} demande${n > 1 ? 's' : ''} de congé en attente`,
    body: demandes.map(d => `${d.worker} — ${d.typeLabel}, du ${d.start} au ${d.end}`).join(' · ').slice(0, 300),
    action_url: '/personnel/conges',
    data: { modal: true, non_blocking: true, kind: CONGES_RAPPEL_TYPE, demandes },
  })
  return { envoye: true, demandes: n, destinataires: ids.length }
}

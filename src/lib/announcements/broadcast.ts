// src/lib/announcements/broadcast.ts
//
// Logique de diffusion d'une annonce (in-app + push natif/web), partagée entre
// l'API /api/announcements et le cron /api/cron/announcements.

import { sendNotification } from '@/lib/notifications/send'

/** Tous les travailleurs liés (personnel.user_id) actifs. */
export async function linkedWorkerIds(sb: any): Promise<string[]> {
  const { data: pers } = await sb.from('personnel').select('user_id').not('user_id', 'is', null).eq('active', true)
  return [...new Set<string>((pers || []).map((p: any) => p.user_id as string))]
}

/** Destinataires effectifs d'une annonce selon son audience. */
export async function resolveTargets(sb: any, ann: any): Promise<string[]> {
  if (ann.audience === 'custom') return [...new Set<string>((ann.target_user_ids || []) as string[])].filter(Boolean)
  return linkedWorkerIds(sb)
}

/** Envoie la notif (in-app + push) à tous les destinataires résolus. */
export async function broadcastAnnouncement(sb: any, ann: any): Promise<{ targeted: number; sent: number; failed: number }> {
  const userIds = await resolveTargets(sb, ann)
  const payload = {
    title:      `${ann.emoji} ${ann.title}`,
    body:       ann.body.length > 140 ? ann.body.slice(0, 137) + '…' : ann.body,
    action_url: ann.action_url,
  }
  let sent = 0, failed = 0
  await Promise.all(userIds.map(async (uid) => {
    const r = await sendNotification(uid, 'feature_announcement', payload).catch(() => ({ ok: false }))
    if ((r as any)?.ok) sent++; else failed++
  }))
  return { targeted: userIds.length, sent, failed }
}

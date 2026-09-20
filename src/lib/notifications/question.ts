// src/lib/notifications/question.ts
//
// QUESTION À L'ÉQUIPE (Olivier 20/09/2026) : poser une question fermée à un ou
// plusieurs utilisateurs via un bandeau in-app NON bloquant (Franck est en
// intervention, on ne le bloque pas) avec des boutons de réponse (ex. « Utile »
// / « Pas utile ») et un commentaire libre facultatif. Le bandeau peut être
// fermé, mais il revient toutes les 10 min tant qu'il n'y a pas de réponse.
// La réponse est notifiée aux demandeurs (`notify_user_ids`).
//
// Mécanique : notifications_log type `question_equipe`, payload.data.question=true
// + choices[] → NotificationBanner rend les boutons → POST /api/notifications/[id]/respond
// { choice, comment } → responded_at + data.answer + notif `question_reponse`.

import { sendNotification } from '@/lib/notifications/send'

export interface QuestionChoice { key: string; label: string; tone?: 'green' | 'red' | 'neutral' }

export async function askTeamQuestion(userIds: string[], q: {
  title: string; body: string; choices: QuestionChoice[]
  notifyUserIds?: string[]; askedBy?: string | null; allowComment?: boolean
}): Promise<{ sent: number; ids: string[] }> {
  const ids: string[] = []
  for (const userId of userIds) {
    const r = await sendNotification(userId, 'question_equipe', {
      title: q.title, body: q.body,
      data: {
        question: true, choices: q.choices, comment: q.allowComment !== false,
        notify_user_ids: q.notifyUserIds || [], asked_by: q.askedBy || null,
      },
    })
    if (r.ok && r.log_id) ids.push(r.log_id)
  }
  return { sent: ids.length, ids }
}

// src/lib/notifications/question-actions.ts
//
// Actions métier déclenchées par la RÉPONSE à une « question à l'équipe »
// (payload.data.on_answer.kind). Olivier 21/09/2026 — première action :
// le doublon Touring soumis au dispatch (cf. touring/neutralize-duplicates.ts).

export async function applyQuestionAnswer(sb: any, onAnswer: Record<string, any>, choice: string, userId: string): Promise<void> {
  const now = new Date().toISOString()
  if (onAnswer.kind === 'touring_duplicate') {
    const missionId = String(onAnswer.mission_id || '')
    if (!missionId) return
    if (choice === 'doublon') {
      await sb.from('incoming_missions').update({ status: 'ignored', dup_question_answer: 'doublon', dup_question_answered_at: now, updated_at: now })
        .eq('id', missionId).eq('status', 'new')
      await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: userId, action: 'ignored', notes: 'Doublon Touring confirmé par le dispatch (mission déjà effectuée) — fiche annulée', metadata: { dedup_dossier: true, by_question: true, sibling: onAnswer.sibling_mission_number || null } }).then(() => {}, () => {})
    } else {
      await sb.from('incoming_missions').update({ dup_question_answer: 'nouvelle', dup_question_answered_at: now, updated_at: now }).eq('id', missionId)
      await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: userId, action: 'note', notes: 'Dispatch : ce n\'est pas un doublon, nouvelle mission à traiter (dossier Touring déjà intervenu)', metadata: { dedup_dossier: false, by_question: true } }).then(() => {}, () => {})
    }
  }
}

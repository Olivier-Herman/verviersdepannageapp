// src/lib/sam/cloture.ts
//
// Fin de conversation à la clôture de la mission. Jusqu'au 29/10/2026, l'agent demandait au chauffeur s'il pouvait
// clôturer la conversation (Olivier 03/10/2026). Désormais (Olivier 29/10/2026) : « si la mission passe en terminé,
// c'est que le problème est réglé » → tout se ferme sans question (samMissionClosed). pendingQuestion / answerQuestion
// restent pour une question encore en attente au moment du changement.

import { createAdminClient } from '@/lib/supabase'
import { IDLE_MINUTES, endConversation } from './journal'

export type SamQuestion = {
  conversation_id: string
  mission_id: string
  agent: string
  texte: string
  texte_fr?: string | null
  boutons: { libelle: string; valeur: 'cloturer_conversation' | 'continuer_conversation' }[]
  apres_oui?: { texte: string; texte_fr?: string | null } | null
  at: string
}

async function addMsg(conversationId: string, m: { role: 'chauffeur' | 'agent'; agent?: string | null; canal: string | null; texte: string; texte_fr?: string | null }) {
  const sb = createAdminClient()
  const now = new Date().toISOString()
  await sb.from('sam_messages').insert({ conversation_id: conversationId, at: now, role: m.role, agent: m.agent || null, canal: m.canal, texte: m.texte.slice(0, 8000), texte_fr: m.texte_fr || null })
  await sb.from('sam_conversations').update({ last_at: now }).eq('id', conversationId)
  const { mirrorSam } = await import('./miroir')
  await mirrorSam(conversationId, m)
}

/**
 * Appelé (en arrière-plan) quand la mission passe à « terminée ». Règle d'Olivier (29/10/2026) : « si la mission passe
 * en terminé, c'est que le problème est réglé » → plus aucune question au chauffeur : les conversations Sam / Sonic de
 * cette mission se ferment sans un mot et ses alertes Sam copilote sont closes.
 */
export async function samMissionClosed(userId: string, missionId: string): Promise<void> {
  try {
    const sb = createAdminClient()
    const now = new Date().toISOString()
    const { data: convs } = await sb.from('sam_conversations').select('id').eq('mission_id', missionId).is('ended_at', null)
    for (const c of convs || []) await endConversation(c.id, 'mission_cloturee')
    await sb.from('sam_alertes').update({ resolved_at: now }).eq('mission_id', missionId).is('resolved_at', null)
    // Question de fin restée en attente (ancien fonctionnement) sur cette mission : retirée.
    const { data: st } = await sb.from('sam_state').select('question').eq('user_id', userId).maybeSingle()
    if ((st as any)?.question?.mission_id === missionId) await sb.from('sam_state').update({ question: null }).eq('user_id', userId)
  } catch (e: any) {
    console.error('[sam/cloture]', e?.message || e)
  }
}

/** Question en attente pour ce chauffeur (fenêtre Aide), ou null. */
export async function pendingQuestion(userId: string): Promise<SamQuestion | null> {
  const { data } = await createAdminClient().from('sam_state').select('question').eq('user_id', userId).maybeSingle()
  const q = (data as any)?.question as SamQuestion | null
  if (!q) return null
  if (Date.now() - new Date(q.at).getTime() > IDLE_MINUTES * 60_000) return null
  return q
}

/** Réponse du chauffeur à la question : « oui » clôt la conversation et renvoie le texte de fin. */
export async function answerQuestion(userId: string, oui: boolean, canal: 'app' | 'telegram'): Promise<{ texte: string | null; agent: string | null }> {
  const sb = createAdminClient()
  const q = await pendingQuestion(userId)
  await sb.from('sam_state').update({ question: null }).eq('user_id', userId)
  if (!q) return { texte: null, agent: null }
  const b = q.boutons.find(x => x.valeur === (oui ? 'cloturer_conversation' : 'continuer_conversation'))
  await addMsg(q.conversation_id, { role: 'chauffeur', canal, texte: b?.libelle || (oui ? 'Oui' : 'Non') })
  if (!oui) return { texte: null, agent: q.agent }
  if (q.apres_oui?.texte) await addMsg(q.conversation_id, { role: 'agent', agent: q.agent, canal, texte: q.apres_oui.texte, texte_fr: q.apres_oui.texte_fr })
  await endConversation(q.conversation_id, 'mission_cloturee')
  return { texte: q.apres_oui?.texte || null, agent: q.agent }
}

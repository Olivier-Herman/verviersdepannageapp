// src/lib/sam/journal.ts
//
// Conversations chauffeur ↔ Sam / Sonic gardées dans VD Soft (Olivier
// 03/10/2026). Chaque échange (app et Telegram) est enregistré : message du
// chauffeur et sa traduction française, réponse de l'agent et sa traduction,
// prénom de l'agent, heure. Une conversation = un agent ; elle se termine
// après 30 min sans message, après une action réussie, ou à la relève.
// Le résumé (2-3 lignes) est écrit par le passage planifié sam-conversations,
// qui supprime aussi les messages après 12 mois (le résumé reste).

import { createAdminClient } from '@/lib/supabase'
import { aiClient } from '@/lib/ai/usage'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import type { SamCanal, SamReply } from './core'

export const IDLE_MINUTES = 30
export const KEEP_MONTHS = 12

type Conv = { id: string; agent: string; mission_id: string | null; last_at: string }

async function openConversation(userId: string): Promise<Conv | null> {
  const { data } = await createAdminClient().from('sam_conversations')
    .select('id, agent, mission_id, last_at').eq('user_id', userId).is('ended_at', null)
    .order('last_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  // Plus de 30 min sans message : elle est terminée, même si le passage planifié ne l'a pas encore fermée.
  if (Date.now() - new Date(data.last_at).getTime() > IDLE_MINUTES * 60_000) {
    await endConversation(data.id, 'inactivite')
    return null
  }
  return data as Conv
}

export async function endConversation(id: string, reason: 'inactivite' | 'action' | 'releve' | 'mission_cloturee') {
  await createAdminClient().from('sam_conversations').update({ ended_at: new Date().toISOString(), end_reason: reason }).eq('id', id).is('ended_at', null)
}

async function newConversation(userId: string, agent: string, missionId: string | null, canal: SamCanal): Promise<Conv> {
  const { data, error } = await createAdminClient().from('sam_conversations')
    .insert({ user_id: userId, agent, mission_id: missionId, canal }).select('id, agent, mission_id, last_at').single()
  if (error || !data) throw new Error(error?.message || 'conversation')
  return data as Conv
}

async function addMessage(conv: Conv, m: { role: 'chauffeur' | 'agent'; agent?: string | null; canal: SamCanal; texte: string; texte_fr?: string | null; photo?: boolean }) {
  const sb = createAdminClient()
  const now = new Date().toISOString()
  await sb.from('sam_messages').insert({ conversation_id: conv.id, at: now, role: m.role, agent: m.agent || null, canal: m.canal, texte: m.texte.slice(0, 8000), texte_fr: m.texte_fr ? m.texte_fr.slice(0, 8000) : null, photo: !!m.photo })
  await sb.from('sam_conversations').update({ last_at: now, canal: m.canal }).eq('id', conv.id)
}

/**
 * Enregistre un tour : message du chauffeur puis réponse(s). Jamais bloquant
 * pour la conversation elle-même (un échec du journal est seulement signalé).
 */
export async function recordExchange(o: { userId: string; missionId: string | null; canal: SamCanal; texte: string; photo?: boolean; reply: SamReply; endAfter?: 'action' | null }) {
  try {
    const sb = createAdminClient()
    const replyAgent = o.reply.agent || 'Sam'
    let conv = await openConversation(o.userId)
    // L'agent qui répond a changé sans relève explicite : l'ancienne conversation est close.
    if (conv && !o.reply.transfert && conv.agent !== replyAgent) { await endConversation(conv.id, 'releve'); conv = null }
    // La mission est connue maintenant : on la rattache.
    if (conv && o.missionId && conv.mission_id !== o.missionId) {
      if (!conv.mission_id) { await sb.from('sam_conversations').update({ mission_id: o.missionId }).eq('id', conv.id); conv.mission_id = o.missionId }
      else { await endConversation(conv.id, 'inactivite'); conv = null }   // autre mission : autre conversation
    }
    const first = conv || await newConversation(o.userId, o.reply.transfert?.agent || replyAgent, o.missionId, o.canal)
    await addMessage(first, { role: 'chauffeur', canal: o.canal, texte: o.texte, texte_fr: o.reply.message_fr || null, photo: o.photo })

    let current = first
    if (o.reply.transfert?.texte) {
      // Relève : le message de l'agent qui part clôt sa partie ; l'agent qui arrive continue
      // dans une nouvelle conversation rattachée à la même mission.
      await addMessage(first, { role: 'agent', agent: o.reply.transfert.agent, canal: o.canal, texte: o.reply.transfert.texte, texte_fr: o.reply.transfert.texte_fr || null })
      await endConversation(first.id, 'releve')
      current = await newConversation(o.userId, replyAgent, o.missionId || first.mission_id, o.canal)
    } else if (first.agent !== replyAgent) {
      await sb.from('sam_conversations').update({ agent: replyAgent }).eq('id', first.id)
    }
    await addMessage(current, { role: 'agent', agent: replyAgent, canal: o.canal, texte: o.reply.texte, texte_fr: o.reply.texte_fr || null })
    if (o.endAfter) await endConversation(current.id, o.endAfter)
  } catch (e: any) {
    console.error('[sam/journal]', e?.message || e)
  }
}

/** Résumé de 2-3 lignes d'une conversation terminée (problème, ce qui a été fait, réglé ou remonté). */
export async function summarize(conversationId: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data: msgs } = await sb.from('sam_messages').select('role, agent, texte, texte_fr, at').eq('conversation_id', conversationId).order('id')
  if (!msgs?.length) return null
  const txt = msgs.map((m: any) => `${m.role === 'chauffeur' ? 'Chauffeur' : (m.agent || 'Agent')} : ${m.texte_fr || m.texte}`).join('\n').slice(0, 20_000)
  const client = aiClient('sam/resume')
  const res: any = await createWithModelFallback(client, ANTHROPIC_MODELS, {
    max_tokens: 300,
    system: 'Tu résumes, en français, une conversation entre un chauffeur dépanneur et l’agent d’aide de son entreprise. 2 à 3 lignes au plus, sans titre ni puces : le problème, ce qui a été fait, et si c’est réglé, en attente ou remonté au dispatch / comme panne. Uniquement des faits présents dans la conversation.',
    messages: [{ role: 'user', content: txt }],
  })
  const s = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim()
  return s || null
}

// src/lib/sam/cloture.ts
//
// Fin de conversation à la clôture de la mission (Olivier 03/10/2026) : quand
// le chauffeur clôture une mission alors qu'une conversation Sam / Sonic liée à
// cette mission est encore ouverte, l'agent lui demande s'il peut la clôturer.
// Le texte vient du bureau (écrit d'avance, aucun appel d'IA). La question est
// livrée sur le canal de la conversation (Telegram, ou la fenêtre Aide à sa
// prochaine ouverture) avec deux boutons :
//   cloturer_conversation  → conversation close tout de suite + « apres_oui »
//   continuer_conversation → la conversation reste ouverte
// Sans réponse, elle se ferme d'elle-même après 30 min, comme toujours.

import { createAdminClient } from '@/lib/supabase'
import { IDLE_MINUTES, endConversation } from './journal'
import { tgSend } from './telegram'

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
}

/** Appelé (en arrière-plan) après la clôture d'une mission par le chauffeur. */
export async function samMissionClosed(userId: string, missionId: string): Promise<void> {
  try {
    const sb = createAdminClient()
    const since = new Date(Date.now() - IDLE_MINUTES * 60_000).toISOString()
    const { data: conv } = await sb.from('sam_conversations').select('id, canal, agent')
      .eq('user_id', userId).eq('mission_id', missionId).is('ended_at', null).gte('last_at', since)
      .order('last_at', { ascending: false }).limit(1).maybeSingle()
    if (!conv) return
    const url = process.env.MOBIOUEB_ADRESSE, secret = process.env.MOBIOUEB_EXTERNE_SECRET
    if (!url || !secret) return
    const [{ data: u }, { data: m }] = await Promise.all([
      sb.from('users').select('id, name, surnom, language').eq('id', userId).maybeSingle(),
      sb.from('incoming_missions').select('id, mission_number, vehicle_plate').eq('id', missionId).maybeSingle(),
    ])
    const canal = conv.canal === 'telegram' ? 'telegram' : 'app'
    const r = await fetch(`${url.replace(/\/$/, '')}/api/externe/sam/mission-cloturee`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chauffeur: { id: userId, prenom: String(u?.surnom || u?.name || '').trim().split(/\s+/)[0] || 'chauffeur', langue: u?.language === 'sq' ? 'sq' : 'fr' },
        canal,
        mission: { id: missionId, numero: m?.mission_number != null ? String(m.mission_number) : undefined, plaque: m?.vehicle_plate || undefined },
      }),
    })
    if (!r.ok) { console.warn('[sam/cloture] bureau', r.status); return }
    const j = await r.json()
    if (!j?.texte) return
    const boutons = (Array.isArray(j.boutons) ? j.boutons : [])
      .filter((b: any) => b && (b.valeur === 'cloturer_conversation' || b.valeur === 'continuer_conversation') && b.libelle)
    const q: SamQuestion = {
      conversation_id: conv.id, mission_id: missionId, agent: String(j.agent || conv.agent || 'Sam'),
      texte: String(j.texte), texte_fr: j.texte_fr || null, boutons, apres_oui: j.apres_oui?.texte ? { texte: String(j.apres_oui.texte), texte_fr: j.apres_oui.texte_fr || null } : null,
      at: new Date().toISOString(),
    }
    await addMsg(conv.id, { role: 'agent', agent: q.agent, canal, texte: q.texte, texte_fr: q.texte_fr })
    await sb.from('sam_state').upsert({ user_id: userId, question: q, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (canal === 'telegram') {
      const { data: link } = await sb.from('telegram_links').select('chat_id').eq('user_id', userId).maybeSingle()
      if (link?.chat_id) await tgSend(Number(link.chat_id), q.texte, q.boutons.map(b => [{ text: b.libelle, data: b.valeur === 'cloturer_conversation' ? 'q:oui' : 'q:non' }]), q.agent)
    }
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

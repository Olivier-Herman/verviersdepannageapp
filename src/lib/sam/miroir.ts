// src/lib/sam/miroir.ts — Olivier suit en direct les échanges des chauffeurs avec Sam et Sonic (14/10/2026).
//
// Groupe Telegram à sujets (réglage app_settings `telegram_groupe_sam` = { chat_id }) : un sujet par
// chauffeur, créé au premier message ; chaque message du journal (app ou Telegram) y est recopié, avec
// la mission en tête de chaque nouvelle conversation. Lecture seule : le bot ne répond jamais dans le
// groupe (le webhook ignore les groupes). Jamais bloquant pour la conversation elle-même.
import { createAdminClient } from '@/lib/supabase'
import { tg } from './telegram'

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function groupe(sb: any): Promise<number | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'telegram_groupe_sam').maybeSingle()
  try { return data?.value ? Number(JSON.parse(data.value).chat_id) || null : null } catch { return null }
}

async function sujet(sb: any, chat: number, userId: string, nom: string): Promise<number | null> {
  const key = `telegram_sujet_sam_${userId}`
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (data?.value) { try { return Number(JSON.parse(data.value)) } catch {} }
  const r = await tg('createForumTopic', { chat_id: chat, name: `🚛 ${nom}`.slice(0, 120) })
  const id = r?.result?.message_thread_id
  if (!id) return null
  await sb.from('app_settings').upsert({ key, value: JSON.stringify(id) }, { onConflict: 'key' })
  return id
}

export async function mirrorSam(conversationId: string, m: { role: 'chauffeur' | 'agent'; agent?: string | null; canal?: string | null; texte: string; texte_fr?: string | null; photo?: boolean }): Promise<void> {
  try {
    const sb = createAdminClient()
    const chat = await groupe(sb)
    if (!chat) return
    const { data: c } = await sb.from('sam_conversations').select('user_id, mission_id, agent').eq('id', conversationId).maybeSingle()
    if (!c) return
    const { data: u } = await sb.from('users').select('name').eq('id', c.user_id).maybeSingle()
    const nom = u?.name || 'Chauffeur'
    const thread = await sujet(sb, chat, c.user_id, nom)
    if (!thread) return
    // Première ligne d'une conversation : de quelle mission il s'agit.
    const { count } = await sb.from('sam_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId)
    let tete = ''
    if ((count || 0) <= 1) {
      let mis = 'sans mission'
      if (c.mission_id) {
        const { data: mm } = await sb.from('incoming_missions').select('mission_number, vehicle_plate, source, status').eq('id', c.mission_id).maybeSingle()
        if (mm) mis = `mission #${mm.mission_number ?? ''} · ${mm.vehicle_plate || ''} · ${mm.source || ''} · ${mm.status}`
      }
      tete = `━━━━━━━━━━\n💬 <b>Nouvelle conversation avec ${esc(c.agent || 'Sam')}</b> — ${esc(mis)}\n`
    }
    const qui = m.role === 'chauffeur' ? `🧑‍🔧 <b>${esc(nom)}</b>` : `🤖 <b>${esc(m.agent || c.agent || 'Sam')}</b>`
    const fr = m.texte_fr && m.texte_fr.trim() && m.texte_fr.trim() !== m.texte.trim()
    const corps = fr ? `${esc(m.texte_fr!)}\n<i>(original : ${esc(m.texte)})</i>` : esc(m.texte)
    await tg('sendMessage', {
      chat_id: chat, message_thread_id: thread, parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: m.role === 'agent',
      text: `${tete}${qui}${m.photo ? ' 📷' : ''}${m.canal === 'telegram' ? ' · Telegram' : ''}\n${corps}`.slice(0, 4000),
    })
  } catch (e: any) { console.warn('[sam/miroir]', e?.message || e) }
}

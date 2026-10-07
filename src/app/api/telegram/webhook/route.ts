// src/app/api/telegram/webhook/route.ts
//
// Webhook du bot @VerviersDepannageBot (Olivier 03/10/2026) : liaison
// (/start <code>), puis conversation avec Sam. Vérifie l'en-tête secret posé
// au setWebhook. Un inconnu est renvoyé vers son profil VD Soft ; un compte
// désactivé n'a plus accès.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { samTurn, samConfirm, agentDuMoment, type SamTurn } from '@/lib/sam/core'
import { tg, tgSend, tgTyping, tgPhotoBase64 } from '@/lib/sam/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UNKNOWN = 'Je ne te connais pas encore : relie ton compte depuis ton profil dans VD Soft.'
const UNKNOWN_SQ = 'Ende nuk të njoh : lidhe llogarinë tënde nga profili yt në VD Soft.'

async function sendTurn(chatId: number, turn: SamTurn) {
  const r = turn.reply
  const rows: Array<Array<{ text: string; data?: string; url?: string }>> = []
  ;(r.boutons || []).forEach((b, i) => rows.push([{ text: b.libelle, data: `b:${i}` }]))
  if (r.action) rows.push([{ text: 'Oui, fais-le', data: 'a:oui' }, { text: 'Non', data: 'a:non' }])
  if (turn.openUrl) rows.push([{ text: 'Ouvrir dans VD Soft', url: turn.openUrl }])
  // Relève : le message de l'agent qui termine son service part d'abord, signé de son prénom.
  if (r.transfert?.texte) await tgSend(chatId, r.transfert.texte, [], r.transfert.agent)
  await tgSend(chatId, r.texte || '…', rows, r.agent || agentDuMoment())
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_VD_WEBHOOK_SECRET
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return NextResponse.json({ ok: false }, { status: 401 })
  const update = await req.json().catch(() => null)
  if (!update) return NextResponse.json({ ok: true })
  const sb = createAdminClient()

  const msg = update.message
  const cbq = update.callback_query
  const chatId: number | undefined = msg?.chat?.id ?? cbq?.message?.chat?.id
  if (!chatId) return NextResponse.json({ ok: true })
  const chatType = msg?.chat?.type || cbq?.message?.chat?.type
  // Groupe de décisions d'Olivier : boutons du sujet « Espèces » (06/10/2026). Seul ce groupe
  // (privé : Olivier et le bot) est écouté ; le clic vaut décision d'Olivier pour CE paiement.
  if (cbq && chatType !== 'private' && String(cbq.data || '').startsWith('es:')) {
    const { decisionsGroup, itemText } = await import('@/lib/especes/telegram')
    const group = await decisionsGroup()
    if (group && Number(cbq.message?.chat?.id) === group) {
      const [, act, idStr] = String(cbq.data).split(':')
      const id = Number(idStr)
      const { adminAction } = await import('@/lib/especes/actions')
      const n = await adminAction([id], act === 'r' ? 'request' : 'transfer')
      const { data: it } = await sb.from('cash_handover_items').select('*').eq('odoo_payment_id', id).maybeSingle()
      const note = n ? (act === 'r' ? '✅ Demandé à Momo : affiché chez lui maintenant.' : '✅ Transféré à Momo : dans son alerte de 13 h à 14 h.') : `ℹ️ Déjà traité (${it?.status || '?'}).`
      await tg('answerCallbackQuery', { callback_query_id: cbq.id, text: note.replace(/^.. /, '') })
      if (it) await tg('editMessageText', { chat_id: group, message_id: cbq.message.message_id, text: itemText(it, note), parse_mode: 'HTML' })
    }
    return NextResponse.json({ ok: true })
  }
  // Doubles paiements (07/10/2026) : Rembourser / Garder / Rappel, depuis le groupe de décisions seulement.
  if (cbq && chatType !== 'private' && String(cbq.data || '').startsWith('dp:')) {
    const { decisionsGroup } = await import('@/lib/especes/telegram')
    const group = await decisionsGroup()
    if (group && Number(cbq.message?.chat?.id) === group) {
      const [, act, idStr] = String(cbq.data).split(':')
      const who = [cbq.from?.first_name, cbq.from?.last_name].filter(Boolean).join(' ') || cbq.from?.username || 'Telegram'
      const { decide } = await import('@/lib/doubles-paiements')
      let res: { note: string; c: any }
      try { res = await decide(Number(idStr), act as any, who) } catch (e: any) { res = { note: `⚠️ Rien n'a été fait : ${e?.message || e}`, c: null } }
      await tg('answerCallbackQuery', { callback_query_id: cbq.id, text: res.note.replace(/^.. /, '').slice(0, 190) })
      if (res.c) await tg('editMessageText', { chat_id: group, message_id: cbq.message.message_id, text: `${res.c.body_html}

<b>${res.note}</b>`, parse_mode: 'HTML', ...(res.c.status === 'open' ? { reply_markup: cbq.message.reply_markup } : {}) })
    }
    return NextResponse.json({ ok: true })
  }
  if (chatType !== 'private') {
    // Groupe de décisions d'Olivier (05/10/2026) : on retient seulement quel groupe
    // a écrit au bot (id, nom, sujets activés) pour y ouvrir les sujets « Doubles
    // paiements » et « Espèces ». Aucune réponse n'est jamais envoyée dans un groupe.
    if (msg?.chat && (chatType === 'group' || chatType === 'supergroup')) {
      const { data: row } = await sb.from('app_settings').select('value').eq('key', 'telegram_groupes_vus').maybeSingle()
      let seen: Record<string, any> = {}
      try { seen = row?.value ? JSON.parse(row.value) : {} } catch { seen = {} }
      seen[String(msg.chat.id)] = { titre: msg.chat.title || '', sujets: !!msg.chat.is_forum, vu_le: new Date().toISOString() }
      await sb.from('app_settings').upsert({ key: 'telegram_groupes_vus', value: JSON.stringify(seen) }, { onConflict: 'key' })
    }
    return NextResponse.json({ ok: true })
  }

  // ── Liaison : /start <code> ────────────────────────────────────────────
  const text: string = String(msg?.text || msg?.caption || '').trim()
  const start = text.match(/^\/start(?:\s+(\S+))?/)
  if (start) {
    const code = start[1]
    if (!code) { await tgSend(chatId, UNKNOWN); return NextResponse.json({ ok: true }) }
    const { data: c } = await sb.from('telegram_link_codes').select('code, user_id, expires_at, used_at').eq('code', code).maybeSingle()
    if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now()) {
      await tgSend(chatId, 'Ce lien n’est plus valable. Recommence depuis ton profil dans VD Soft (« Relier Telegram »).')
      return NextResponse.json({ ok: true })
    }
    await sb.from('telegram_link_codes').update({ used_at: new Date().toISOString() }).eq('code', code).is('used_at', null)
    await sb.from('telegram_links').delete().eq('chat_id', chatId)     // ce téléphone n'appartient plus qu'à un compte
    await sb.from('telegram_links').upsert({ user_id: c.user_id, chat_id: chatId, tg_username: msg?.from?.username || null, linked_at: new Date().toISOString() }, { onConflict: 'user_id' })
    const { data: u } = await sb.from('users').select('name, surnom, language, role, roles').eq('id', c.user_id).maybeSingle()
    const p = String(u?.name || '').trim().split(/\s+/)[0]   // prénom, jamais le surnom de Matthieu
    if (u && u.role !== 'driver' && !(Array.isArray(u.roles) && u.roles.includes('driver'))) {
      await tgSend(chatId, `Bonjour ${p}, ton compte VD Soft est relié. Tu recevras ici les questions des agents, avec des boutons pour répondre.`)
      return NextResponse.json({ ok: true })
    }
    await tgSend(chatId, u?.language === 'sq'
      ? `Përshëndetje ${p}, llogaria jote VD Soft është e lidhur. Nëse bllokohesh në aplikacion, më shkruaj këtu ose dërgo një foto të ekranit : Sam përgjigjet ditën, Sonic natën.`
      : `Salut ${p}, ton compte VD Soft est relié. Si tu bloques dans l'app, écris-moi ici ou envoie une photo de ton écran : Sam te répond le jour, Sonic la nuit.`)
    return NextResponse.json({ ok: true })
  }

  // ── Qui écrit ? ────────────────────────────────────────────────────────
  const { data: link } = await sb.from('telegram_links').select('user_id').eq('chat_id', chatId).maybeSingle()
  const { data: user } = link ? await sb.from('users').select('id, name, active, language, role, roles').eq('id', link.user_id).maybeSingle() : { data: null }
  if (!link || !user?.active) {
    if (cbq) await tg('answerCallbackQuery', { callback_query_id: cbq.id })
    await tgSend(chatId, msg?.from?.language_code === 'sq' ? UNKNOWN_SQ : UNKNOWN)
    return NextResponse.json({ ok: true })
  }

  // Réponse à une question d'agent (Olivier 05/10/2026) : « aq:<proposition>:<choix> ».
  if (cbq && String(cbq.data || '').startsWith('aq:')) {
    const [, pid, key] = String(cbq.data).split(':')
    const { answerAgentQuestion } = await import('@/lib/agents/question')
    const r = await answerAgentQuestion(pid, user.id, String((user as any).name || 'Mobi'), key, 'telegram')
    await tg('answerCallbackQuery', { callback_query_id: cbq.id, text: r.note.slice(0, 190) })
    await tgSend(chatId, r.note)
    return NextResponse.json({ ok: true })
  }
  // Compte du bureau (pas chauffeur) : ce canal sert aux questions des agents, pas à Sam.
  const isDriver = (user as any).role === 'driver' || (Array.isArray((user as any).roles) && (user as any).roles.includes('driver'))
  if (!isDriver) {
    if (cbq) await tg('answerCallbackQuery', { callback_query_id: cbq.id })
    await tgSend(chatId, 'Ici, tu reçois les questions des agents. Réponds avec les boutons sous chaque question ; tout est aussi dans VD Soft, « Propositions des agents ».')
    return NextResponse.json({ ok: true })
  }

  try {
    await tgTyping(chatId)
    let turn: SamTurn
    if (cbq) {
      await tg('answerCallbackQuery', { callback_query_id: cbq.id })
      const data = String(cbq.data || '')
      if (data === 'q:oui' || data === 'q:non') {
        // Réponse à « Je peux clôturer notre conversation ? » (mission clôturée) : pas d'appel à l'agent.
        const { answerQuestion } = await import('@/lib/sam/cloture')
        const r = await answerQuestion(user.id, data === 'q:oui', 'telegram')
        if (r.texte) await tgSend(chatId, r.texte, [], r.agent || agentDuMoment())
        return NextResponse.json({ ok: true })
      }
      if (data === 'a:oui' || data === 'a:non') turn = await samConfirm({ userId: user.id, canal: 'telegram', oui: data === 'a:oui' })
      else {
        // Bouton de choix : on renvoie son LIBELLÉ (lisible dans l'historique).
        const { data: st } = await sb.from('sam_state').select('buttons').eq('user_id', user.id).maybeSingle()
        const b = (st?.buttons || [])[Number(data.split(':')[1])]
        if (!b) { await tgSend(chatId, 'Ce choix n’est plus valable, écris-moi ta question.'); return NextResponse.json({ ok: true }) }
        turn = await samTurn({ userId: user.id, canal: 'telegram', texte: b.libelle })
      }
    } else {
      const photo = msg?.photo?.length ? await tgPhotoBase64(msg.photo) : null
      if (!text && !photo) { await tgSend(chatId, user.language === 'sq' ? 'Më shkruaj ose dërgo një foto.' : 'Écris-moi ou envoie une photo.'); return NextResponse.json({ ok: true }) }
      turn = await samTurn({ userId: user.id, canal: 'telegram', texte: text || '(photo)', photo })
    }
    await sendTurn(chatId, turn)
  } catch (e: any) {
    console.error('[telegram/webhook]', e?.message || e)
    const n = agentDuMoment()
    await tgSend(chatId, user.language === 'sq'
      ? `${n} nuk është i disponueshëm për momentin. Nëse është urgjente, telefono dispeçerin.`
      : `${n} n’est pas disponible pour le moment. Si c’est urgent, appelle le dispatch.`)
  }
  return NextResponse.json({ ok: true })
}

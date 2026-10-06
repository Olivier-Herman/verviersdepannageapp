// src/lib/especes/telegram.ts
//
// Sujet « Espèces » du groupe Telegram « VD Soft - Mobi » (Olivier 06/10/2026) : un message
// par paiement à remettre, avec « Demander à Momo s'il a reçu » et « Transférer à Momo ».
// Le clic fait la même chose que les boutons de l'écran (adminAction).

import { createAdminClient } from '@/lib/supabase'
import { tg } from '@/lib/sam/telegram'

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const eur = (n: number) => Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const d = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')

export async function decisionsGroup(): Promise<number | null> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'telegram_groupe_decisions').maybeSingle()
  try { return data?.value ? Number(JSON.parse(data.value).chat_id) : null } catch { return null }
}

/** Identifiant du sujet (créé la première fois). */
export async function topicId(name: string, key: string): Promise<number | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (data?.value) { try { return Number(JSON.parse(data.value)) } catch {} }
  const chat = await decisionsGroup(); if (!chat) return null
  const r = await tg('createForumTopic', { chat_id: chat, name })
  const id = r?.result?.message_thread_id
  if (!id) return null
  await sb.from('app_settings').upsert({ key, value: JSON.stringify(id) }, { onConflict: 'key' })
  return id
}

export function itemText(it: any, extra = ''): string {
  const lieu = it.intervention_date || it.place ? `${d(it.intervention_date) || 'date ?'} · ${it.place || 'lieu ?'}${it.place_guessed ? ' (déduit de la plaque, à vérifier)' : ''}` : 'date non renseignée · lieu non renseigné'
  return `<b>${esc(String(it.payment_name).split('/').pop() || '')} · facture ${esc(it.invoice || '?')} · ${eur(it.amount)}</b>\n${esc(it.client || '')} — encaissé par ${esc(it.holder_label || '?')} (${d(it.payment_date)})\n🚗 ${esc(it.vehicle || 'véhicule non renseigné')}\n📍 ${esc(lieu)}${extra ? `\n${extra}` : ''}`
}

export async function sendItemsToTelegram(items: any[], intro?: string): Promise<number> {
  const chat = await decisionsGroup(); const thread = await topicId('Espèces', 'telegram_sujet_especes')
  if (!chat || !thread) throw new Error('Groupe ou sujet Telegram introuvable')
  if (intro) await tg('sendMessage', { chat_id: chat, message_thread_id: thread, text: intro, parse_mode: 'HTML' })
  let n = 0
  for (const it of items) {
    const r = await tg('sendMessage', { chat_id: chat, message_thread_id: thread, text: itemText(it), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Demander à Momo s’il a reçu', callback_data: `es:r:${it.odoo_payment_id}` }], [{ text: 'Transférer à Momo', callback_data: `es:t:${it.odoo_payment_id}` }]] } })
    if (r?.ok) n++
  }
  return n
}

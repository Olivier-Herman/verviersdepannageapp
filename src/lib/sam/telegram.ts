// src/lib/sam/telegram.ts
//
// Bot Telegram @VerviersDepannageBot : SEULEMENT l'aide de Sam (Olivier
// 03/10/2026). Aucune notification de mission ne passe par ici.

const TOKEN = () => process.env.TELEGRAM_VD_BOT_TOKEN || ''

export async function tg(method: string, body: Record<string, any>): Promise<any> {
  if (!TOKEN()) throw new Error('Bot Telegram non configuré')
  const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!j.ok) console.warn(`[telegram] ${method}:`, j.description || r.status)
  return j
}

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Message avec boutons (inline). `rows` : lignes de { text, data } ou { text, url }. */
export async function tgSend(chatId: number, text: string, rows: Array<Array<{ text: string; data?: string; url?: string }>> = []) {
  return tg('sendMessage', {
    chat_id: chatId, text: esc(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: rows.length ? { inline_keyboard: rows.map(r => r.map(b => b.url ? { text: b.text.slice(0, 60), url: b.url } : { text: b.text.slice(0, 60), callback_data: String(b.data).slice(0, 60) })) } : undefined,
  })
}

/** « Sam écrit… » (dure ~5 s côté Telegram). */
export async function tgTyping(chatId: number) { return tg('sendChatAction', { chat_id: chatId, action: 'typing' }) }

/** Plus grande photo d'un message → base64 JPEG (≤ 5 Mo). */
export async function tgPhotoBase64(photos: any[]): Promise<string | null> {
  const best = [...(photos || [])].sort((a, b) => (b.file_size || 0) - (a.file_size || 0)).find(p => (p.file_size || 0) <= 5_000_000)
  if (!best) return null
  const f = await tg('getFile', { file_id: best.file_id })
  if (!f.ok || !f.result?.file_path) return null
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN()}/${f.result.file_path}`, { cache: 'no-store' })
  if (!r.ok) return null
  return Buffer.from(await r.arrayBuffer()).toString('base64')
}

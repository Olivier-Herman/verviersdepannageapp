// src/lib/notif/heures-mobi.ts — notifications Telegram de Mobi selon ses heures « Verviers Dépannage »
// (Olivier 24/10/2026 : « J'indique Verviers Dépannage dans mon agenda les jours et heures où je bosse. En dehors
// de ces heures-là je ne prends que les notifs urgentes. »)
//
// Heures : les rendez-vous « Verviers Dépannage » de l'agenda de mobi@ (invité à ceux d'Olivier), lus par l'ERP
// de messagerie. Sans accès à l'agenda : réglage `mobi_heures_vd` (par défaut lun-ven 9 h-18 h, son horaire
// actuel). Hors heures, une notification non urgente est retenue (table telegram_differes) puis envoyée en bloc
// au début du créneau suivant (cron telegram-differes). Les réponses du bot à Mobi ne passent pas par ici.

import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { tgSend } from '@/lib/sam/telegram'

type Rows = Array<Array<{ text: string; data?: string; url?: string }>>
let cache: { at: number; slots: { start: number; end: number }[] | null } | null = null

const bxl = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]))
  return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)), min: Number(p.hour) % 24 * 60 + Number(p.minute) }
}

/** Créneaux « Verviers Dépannage » des 8 prochains jours dans l'agenda de mobi@ (null = agenda inaccessible). */
async function creneauxAgenda(): Promise<{ start: number; end: number }[] | null> {
  if (cache && Date.now() - cache.at < 15 * 60e3) return cache.slots
  let slots: { start: number; end: number }[] | null = null
  try {
    const box = await getBusinessText('agents_boite_comptable')   // mobi@ (boîte de Mobi)
    const tok = await getAppOnlyToken()
    const from = new Date(Date.now() - 86400e3).toISOString(), to = new Date(Date.now() + 8 * 86400e3).toISOString()
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box)}/calendarView?startDateTime=${from}&endDateTime=${to}&$top=100&$select=subject,start,end,isCancelled`,
      { headers: { Authorization: `Bearer ${tok}`, Prefer: 'outlook.timezone="UTC"' }, cache: 'no-store' })
    if (r.ok) {
      const j: any = await r.json()
      slots = (j.value || []).filter((e: any) => !e.isCancelled && /verviers\s*d[ée]pannage/i.test(e.subject || ''))
        .map((e: any) => ({ start: Date.parse(e.start.dateTime + 'Z'), end: Date.parse(e.end.dateTime + 'Z') }))
    }
  } catch { /* agenda inaccessible : horaire du réglage */ }
  cache = { at: Date.now(), slots }
  return slots
}

/** Réglage de secours : « 1-5 09:00-18:00 » (jours 1 = lundi … 7 = dimanche). */
async function horaireReglage(d: Date): Promise<boolean> {
  const v = (await getBusinessText('mobi_heures_vd').catch(() => '')) || '1-5 09:00-18:00'
  const m = v.match(/(\d)-(\d)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/)
  if (!m) return true
  const { wd, min } = bxl(d); const jour = wd === 0 ? 7 : wd
  return jour >= +m[1] && jour <= +m[2] && min >= +m[3] * 60 + +m[4] && min < +m[5] * 60 + +m[6]
}

export async function mobiEnHeuresVD(d = new Date()): Promise<boolean> {
  const slots = await creneauxAgenda()
  if (slots) return slots.some(s => d.getTime() >= s.start && d.getTime() < s.end)
  return horaireReglage(d)
}

/** Notification Telegram : vers Mobi hors de ses heures VD, retenue sauf si urgente. Autres destinataires : directe. */
export async function notifierTelegram(chatId: number, texte: string, rows: Rows = [], expediteur?: string, opts: { urgent?: boolean } = {}) {
  const mobi = await getBusinessNumber('telegram_chat_mobi').catch(() => 0)
  if (chatId === mobi && !opts.urgent && !(await mobiEnHeuresVD())) {
    await createAdminClient().from('telegram_differes').insert({ chat_id: chatId, texte, rows, expediteur: expediteur || null })
    return { differe: true }
  }
  return tgSend(chatId, texte, rows, expediteur)
}

/** Début de créneau : envoie dans l'ordre ce qui a été retenu. */
export async function envoyerDifferes(): Promise<number> {
  if (!(await mobiEnHeuresVD())) return 0
  const sb = createAdminClient()
  const { data } = await sb.from('telegram_differes').select('*').order('id').limit(50)
  let n = 0
  for (const m of data || []) {
    try { await tgSend(Number(m.chat_id), m.texte, m.rows || [], m.expediteur || undefined); await sb.from('telegram_differes').delete().eq('id', m.id); n++ } catch { break }
  }
  return n
}

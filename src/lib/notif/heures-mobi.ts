// src/lib/notif/heures-mobi.ts — notifications Telegram de Mobi selon ses heures « Verviers Dépannage »
// (Olivier 24/10/2026 : « J'indique Verviers Dépannage dans mon agenda les jours et heures où je bosse. En dehors
// de ces heures-là je ne prends que les notifs urgentes. »)
//
// Heures : les rendez-vous « Verviers Dépannage » de l'agenda de mobi@ (invité à ceux d'Olivier), lus par l'ERP
// de messagerie. Sans accès à l'agenda : réglage `mobi_heures_vd` (par défaut lun-jeu 9 h-18 h : plus de
// vendredi chez VD depuis le 26/10/2026). Hors heures, une notification non urgente est retenue (table telegram_differes) puis envoyée en bloc
// au début du créneau suivant (cron telegram-differes). Les réponses du bot à Mobi ne passent pas par ici.
// URGENT (passe à toute heure, Olivier 24/10/2026) : toute panne qui empêche l'app de fonctionner normalement
// (imprimante, connecteur, cron en échec…) et l'alerte de coût IA. Le reste attend le créneau.

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
    // Accès délégué à l'agenda (connexion par code d'appareil du 28/10/2026) : l'accès applicatif est refusé (403)
    // sur les agendas, d'où le repli permanent sur l'horaire du réglage avant cette date.
    const { jetonAgenda } = await import('@/lib/calendar/device')
    const tok = (await jetonAgenda(box).catch(() => null)) || await getAppOnlyToken()
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

/** Réglage de secours : « 1-4 09:00-18:00 » (jours 1 = lundi … 7 = dimanche). */
async function horaireReglage(d: Date): Promise<boolean> {
  const v = (await getBusinessText('mobi_heures_vd').catch(() => '')) || '1-4 09:00-18:00'
  const m = v.match(/(\d)-(\d)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/)
  if (!m) return true
  const { wd, min } = bxl(d); const jour = wd === 0 ? 7 : wd
  return jour >= +m[1] && jour <= +m[2] && min >= +m[3] * 60 + +m[4] && min < +m[5] * 60 + +m[6]
}

/**
 * Mobi travaille-t-il ce JOUR-là pour VD ? Les agents suivent ses jours, pas ses heures (Olivier 09/11/2026 : « un agent
 * qui a un passage à 7 h un jour que je travaille doit passer »). Ses notifications, elles, restent à ses heures.
 */
export async function mobiJourVD(d = new Date()): Promise<boolean> {
  const jourBxl = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date(t))
  const slots = await creneauxAgenda()
  if (slots) return slots.some(s => jourBxl(s.start) === jourBxl(d.getTime()))
  const v = (await getBusinessText('mobi_heures_vd').catch(() => '')) || '1-4 09:00-18:00'
  const m = v.match(/(\d)-(\d)/)
  if (!m) return true
  const { wd } = bxl(d); const jour = wd === 0 ? 7 : wd
  return jour >= +m[1] && jour <= +m[2]
}

export async function mobiEnHeuresVD(d = new Date()): Promise<boolean> {
  const slots = await creneauxAgenda()
  if (slots) return slots.some(s => d.getTime() >= s.start && d.getTime() < s.end)
  return horaireReglage(d)
}

/** Notification Telegram : vers Mobi hors de ses heures VD, retenue sauf si urgente. Autres destinataires : directe. */
export async function notifierTelegram(chatId: number, texte: string, rows: Rows = [], expediteur?: string, opts: { urgent?: boolean } = {}) {
  const mobi = await getBusinessNumber('telegram_chat_mobi').catch(() => 0)
  // « Mes assistants » en pause (Olivier 28/10/2026) : ses notifications non urgentes sont gardées comme hors heures.
  const enPause = async () => { const { assistantEnPause } = await import('@/lib/facturation/suspension'); return assistantEnPause(createAdminClient(), 'telegram') }
  if (chatId === mobi && !opts.urgent && (!(await mobiEnHeuresVD()) || (await enPause()))) {
    await createAdminClient().from('telegram_differes').insert({ chat_id: chatId, texte, rows, expediteur: expediteur || null })
    return { differe: true }
  }
  return tgSend(chatId, texte, rows, expediteur)
}

/** Début de créneau : envoie dans l'ordre ce qui a été retenu. */
export async function envoyerDifferes(): Promise<number> {
  if (!(await mobiEnHeuresVD())) return 0
  const sb = createAdminClient()
  { const { assistantEnPause } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(sb, 'telegram')) return 0 }
  const { data } = await sb.from('telegram_differes').select('*').order('id').limit(50)
  let n = 0
  for (const m of data || []) {
    try { await tgSend(Number(m.chat_id), m.texte, m.rows || [], m.expediteur || undefined); await sb.from('telegram_differes').delete().eq('id', m.id); n++ } catch { break }
  }
  return n
}

/** Information pour Mobi → Supervision de l'app HOOS (Olivier 18/11/2026 : « les notifications passent dans l'app HOOS
 *  à la place de Telegram, Telegram reste réservé aux urgences »). Mêmes paramètres que notifierTelegram, pour remplacer
 *  l'appel tel quel. Hors des heures VD de Mobi, la ligne est écrite sans sonner son téléphone. Si la Supervision ne
 *  répond pas (ou n'est pas configurée), repli sur Telegram : rien ne se perd. Aucun bouton : la Supervision ne renvoie
 *  rien vers VD Soft pour l'instant. */
export async function informerMobi(chatId: number, texte: string, rows: Rows = [], expediteur?: string, opts: { urgent?: boolean; lien?: string; cle?: string } = {}) {
  const url = process.env.SUPERVISION_URL, cle = process.env.SUPERVISION_VDSOFT_CLE
  const mobi = await getBusinessNumber('telegram_chat_mobi').catch(() => 0)
  if (url && cle && chatId === mobi) {
    try {
      const lignes = String(texte || '').split('\n')
      const titre = (lignes[0] || 'VD Soft').replace(/\s+/g, ' ').trim().slice(0, 300)
      const reste = lignes.slice(1).join('\n').trim()
      const notifier = opts.urgent ? true : await mobiEnHeuresVD().catch(() => true)
      const r = await fetch(url, {
        method: 'POST', cache: 'no-store',
        headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          societe: 'Verviers Dépannage', titre, resume: (reste || titre).slice(0, 4000), contenu: String(texte).slice(0, 20000), type: 'info',
          ...(expediteur ? { agent: expediteur } : {}), ...(opts.lien ? { lien: opts.lien } : {}), ...(opts.cle ? { cle: opts.cle.slice(0, 120) } : {}),
          ...(notifier ? {} : { notifier: false }),
        }),
      })
      if (r.status === 201 || r.ok) return { supervision: true }
      console.error('[supervision]', r.status, (await r.text()).slice(0, 200))
    } catch (e: any) { console.error('[supervision]', e?.message || e) }
  }
  return notifierTelegram(chatId, texte, rows, expediteur, { urgent: opts.urgent })
}

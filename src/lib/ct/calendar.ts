// src/lib/ct/calendar.ts
//
// Crée un évènement « Contrôle technique » dans le calendrier Outlook/M365 de
// info@verviersdepannage.com via Microsoft Graph (app-only), avec un rappel
// 1 mois avant. On est en M365 (pas Google). Olivier 2026-08-03.

import { getAppToken } from '@/lib/emails'

const CT_MAILBOX = process.env.CT_CALENDAR_MAILBOX || 'info@verviersdepannage.com'
const TZ = 'Romance Standard Time'   // Europe/Brussels côté Graph

/** Formate un timestamptz en heure locale Bruxelles "YYYY-MM-DDTHH:mm:ss" (sans offset). */
function localDateTime(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find(p => p.type === t)?.value || '00'
  let hh = g('hour'); if (hh === '24') hh = '00'
  return `${g('year')}-${g('month')}-${g('day')}T${hh}:${g('minute')}:${g('second')}`
}

export interface CtEventInput {
  rdv_at:         string          // ISO
  plate?:         string | null
  brand?:         string | null
  model?:         string | null
  center_name?:   string | null
  center_address?: string | null
}

/** Retourne l'id de l'évènement Graph créé, ou null si échec (non bloquant). */
export async function createCtCalendarEvent(input: CtEventInput): Promise<string | null> {
  try {
    const token = await getAppToken()
    const veh = [input.plate, input.brand, input.model].filter(Boolean).join(' ')
    const start = new Date(input.rdv_at)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    const body = {
      subject: `Contrôle technique — ${veh || 'véhicule'}`,
      body: { contentType: 'text', content: `Convocation au contrôle technique.\nVéhicule : ${veh || '—'}\nCentre : ${[input.center_name, input.center_address].filter(Boolean).join(' · ') || '—'}\n\nCréé automatiquement depuis VD Soft.` },
      start: { dateTime: localDateTime(start.toISOString()), timeZone: TZ },
      end:   { dateTime: localDateTime(end.toISOString()),   timeZone: TZ },
      location: { displayName: [input.center_name, input.center_address].filter(Boolean).join(' · ') || 'Contrôle technique' },
      categories: ['Contrôle technique'],
      isReminderOn: true,
      reminderMinutesBeforeStart: 30 * 24 * 60,   // 1 mois avant
    }
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(CT_MAILBOX)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[CT calendar] échec Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return null
    }
    const j = await res.json()
    return j?.id || null
  } catch (e: any) {
    console.warn('[CT calendar] exception:', e?.message)
    return null
  }
}

// src/lib/circuit/agenda.ts — prestations du Circuit de Spa dans les agendas Outlook (Olivier 28/10/2026).
//   • agenda d'info@ : chaque jour de prestation, « Activité – N dépanneuse(s) » (incentives et week-ends de course) ;
//   • agenda de Mobi : à partir de N dépanneuses (réglage circuit_agenda_seuil_mobi, 2), avec Olivier invité
//     (réglage circuit_agenda_invite).
// Événements sur la journée entière, au Circuit. Synchronisés : créés, modifiés (date, intitulé), supprimés quand la
// prestation disparaît. Seulement ce qui commence aujourd'hui ou plus tard. Accès par jeton délégué (calendar/device).

import { createAdminClient } from '@/lib/supabase'
import { jetonAgenda } from '@/lib/calendar/device'
import { MAIL_AGENT_MAILBOX } from '@/lib/mail-agent'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'

type Voulu = { key: string; date: string; subject: string; nb: number }
const jourBxl = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const lendemain = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const intitule = (act: string, nb: number) => `${act} – ${nb} dépanneuse${nb > 1 ? 's' : ''}`

/** Ce qui doit figurer dans l'agenda, à partir d'aujourd'hui. */
export async function evenementsVoulus(sb: any): Promise<Voulu[]> {
  const today = jourBxl()
  const out: Voulu[] = []
  const { data: ps } = await sb.from('circuit_prestations').select('id, prestation_date, nb_depanneuses, notes, client_name, type').gte('prestation_date', today)
  for (const p of ps || []) {
    const nb = Number(p.nb_depanneuses) || 1
    out.push({ key: `p:${p.id}`, date: p.prestation_date, nb, subject: intitule(String(p.notes || p.client_name || 'Prestation circuit').trim(), nb) })
  }
  const { data: ws } = await sb.from('circuit_race_weekends').select('id, label, days')
  for (const w of ws || []) {
    const parJour = new Map<string, number>()
    for (const d of Array.isArray(w.days) ? w.days : []) {
      if (!d?.date || d.date < today) continue
      parJour.set(d.date, Math.max(parJour.get(d.date) || 0, Number(d.nb) || 0))   // jour et nuit : on garde le plus grand
    }
    for (const [date, nb] of parJour) if (nb > 0) out.push({ key: `w:${w.id}:${date}`, date, nb, subject: intitule(String(w.label || 'Course').trim(), nb) })
  }
  return out
}

async function graph(tok: string, method: string, path: string, body?: any) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  if (r.status === 204) return null
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e: any = new Error(`${method} ${path} : ${j?.error?.message || r.status}`); e.status = r.status; throw e }
  return j
}

/** Synchronise une boîte. `invite` : adresse ajoutée en participant. */
async function syncBoite(sb: any, mailbox: string, voulus: Voulu[], invite: string | null): Promise<{ crees: number; modifies: number; supprimes: number }> {
  const tok = await jetonAgenda(mailbox)
  if (!tok) throw new Error(`Agenda de ${mailbox} non connecté`)
  const res = { crees: 0, modifies: 0, supprimes: 0 }
  const base = `/users/${encodeURIComponent(mailbox)}`   // jeton de la boîte ou d'un compte qui y a accès
  const { data: connus } = await sb.from('circuit_calendar_events').select('key, event_id, subject, event_date').eq('mailbox', mailbox)
  const parCle = new Map((connus || []).map((c: any) => [c.key, c]))
  const corps = (v: Voulu) => ({
    subject: v.subject, isAllDay: true, showAs: 'free',
    start: { dateTime: `${v.date}T00:00:00`, timeZone: 'Europe/Brussels' }, end: { dateTime: `${lendemain(v.date)}T00:00:00`, timeZone: 'Europe/Brussels' },
    location: { displayName: 'Circuit de Spa-Francorchamps' },
    ...(invite ? { attendees: [{ emailAddress: { address: invite }, type: 'required' }] } : {}),
  })
  for (const v of voulus) {
    const c: any = parCle.get(v.key)
    if (c && c.subject === v.subject && c.event_date === v.date) continue
    if (c) {
      try { await graph(tok, 'PATCH', `${base}/events/${c.event_id}`, corps(v)); res.modifies++ }
      catch (e: any) { if (e.status !== 404) throw e; const n = await graph(tok, 'POST', `${base}/events`, corps(v)); c.event_id = n.id; res.crees++ }
      await sb.from('circuit_calendar_events').update({ event_id: c.event_id, subject: v.subject, event_date: v.date, updated_at: new Date().toISOString() }).eq('key', v.key).eq('mailbox', mailbox)
    } else {
      const n = await graph(tok, 'POST', `${base}/events`, corps(v)); res.crees++
      await sb.from('circuit_calendar_events').insert({ key: v.key, mailbox, event_id: n.id, subject: v.subject, event_date: v.date })
    }
  }
  // Prestations disparues (seulement à venir : le passé reste tel quel)
  const cles = new Set(voulus.map(v => v.key)), today = jourBxl()
  for (const c of (connus || []) as any[]) {
    if (cles.has(c.key) || c.event_date < today) continue
    try { await graph(tok, 'DELETE', `${base}/events/${c.event_id}`) } catch (e: any) { if (e.status !== 404) throw e }
    await sb.from('circuit_calendar_events').delete().eq('key', c.key).eq('mailbox', mailbox); res.supprimes++
  }
  return res
}

export async function syncAgendasCircuit(): Promise<Record<string, any>> {
  const sb = createAdminClient()
  const voulus = await evenementsVoulus(sb)
  const out: Record<string, any> = { voulus: voulus.length }
  const boiteMobi = await getBusinessText('agents_boite_comptable')   // mobi@
  const seuil = await getBusinessNumber('circuit_agenda_seuil_mobi').catch(() => 2)
  const invite = await getBusinessText('circuit_agenda_invite').catch(() => '')
  for (const [box, liste, inv] of [[MAIL_AGENT_MAILBOX, voulus, null], [boiteMobi, voulus.filter(v => v.nb >= seuil), invite || null]] as const) {
    try { out[box] = await syncBoite(sb, box, liste as Voulu[], inv) }
    catch (e: any) { out[box] = { erreur: String(e?.message || e) } }
  }
  return out
}

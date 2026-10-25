// src/lib/time/controle-heures.ts — surveillance des heures reçues des assistances (Olivier 25/10/2026 : « ça ne
// peut pas arriver, il faut un automatisme »). Toutes les heures : pour les missions arrivées ces 3 dernières heures,
// écart entre l'heure de réception annoncée par l'assistance et l'heure de création de la fiche. Une heure pile
// d'écart (50-70 min) sur au moins 2 missions d'une même source = fuseau horaire faux → alerte URGENTE à Mobi
// (une panne qui fausse les délais assisteurs), au plus une fois par source et par 12 h.
import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber } from '@/lib/settings/business'
import { notifierTelegram } from '@/lib/notif/heures-mobi'

export async function controleHeures(): Promise<{ sources: Record<string, { n: number; decales: number }>; alertes: string[] }> {
  const sb = createAdminClient()
  const { data } = await sb.from('incoming_missions').select('mission_number,source,received_at,created_at')
    .gte('created_at', new Date(Date.now() - 3 * 3600e3).toISOString()).not('received_at', 'is', null)
  const par: Record<string, { n: number; decales: number; ex: string[] }> = {}
  for (const m of data || []) {
    const ecart = (Date.parse(m.created_at) - Date.parse(m.received_at)) / 60e3   // + : reçue « avant » la fiche
    const s = (par[m.source] ||= { n: 0, decales: 0, ex: [] })
    s.n++
    if (Math.abs(Math.abs(ecart) - 60) <= 10) { s.decales++; s.ex.push(`#${m.mission_number} (${ecart > 0 ? '−' : '+'}${Math.round(Math.abs(ecart))} min)`) }
  }
  const alertes: string[] = []
  for (const [src, s] of Object.entries(par)) {
    if (s.decales < 2) continue
    const key = `controle_heures_alerte_${src}`
    const { data: last } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
    if (last?.value && Date.now() - Date.parse(JSON.parse(last.value)) < 12 * 3600e3) continue
    const txt = `⚠️ Heures faussées d'une heure pour les missions ${src} : ${s.decales} sur ${s.n} depuis 3 h (${s.ex.slice(0, 4).join(', ')}). Probable fuseau horaire faux (changement d'heure ?) : les délais vis-à-vis de l'assistance sont faux tant que ce n'est pas corrigé.`
    await notifierTelegram(await getBusinessNumber('telegram_chat_mobi'), txt, [], 'Contrôle des heures', { urgent: true })
    await sb.from('app_settings').upsert({ key, value: JSON.stringify(new Date().toISOString()), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    alertes.push(txt)
  }
  return { sources: Object.fromEntries(Object.entries(par).map(([k, v]) => [k, { n: v.n, decales: v.decales }])), alertes }
}

// src/lib/kaze/proposal-watch.ts
//
// Filet de sécurité des propositions IMA via Kaze (Olivier 08/10/2026). Normalement, à chaque
// mail IMA « Mail IMA - <commande> - … - A traiter », Kaze envoie dans la seconde la proposition
// à VD Soft, qui crée la fiche avec le bouton « Accepter ». Le 08/10, pour B61252749AA (1PUD057),
// Kaze n'a rien envoyé : ni la proposition ni l'acceptation, seulement l'affectation 9 minutes
// plus tard. Ici : un mail IMA sans fiche VD Soft (même numéro de commande) après quelques
// minutes déclenche une alerte au dispatch, pour accepter à temps dans Kaze. Une seule fois par commande.

import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessText } from '@/lib/settings/business'

const G = 'https://graph.microsoft.com/v1.0'
const BOX = 'info@verviersdepannage.com'
const GRACE_MS = 3 * 60_000          // laisse le temps à Kaze d'envoyer la proposition
const WINDOW_MS = 2 * 3600_000       // on ne regarde que les mails des 2 dernières heures
const SEEN_KEY = 'kaze_proposal_watch_alerted'

export const field = (text: string, label: string) => text.match(new RegExp(`${label}\\s*:\\s*([^\\n]*?)\\s*(?=(?:Numéro de commande|Moyen|Marque|Modèle|Immatriculation|Prédiagnostic|Tel sur place|Adresse de depart|Date de départ prévue|Adresse d'arrivée|Cordialement)\\s*:?|$)`, 'i'))?.[1]?.trim() || ''

export async function watchImaProposals(): Promise<{ checked: number; alerted: string[] }> {
  const out = { checked: 0, alerted: [] as string[] }
  const tok = await getAppOnlyToken()
  if (!tok) return out
  const SENDER = await getBusinessText('mail_ima_propositions').catch(() => '')
  if (!SENDER) return out
  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const r = await fetch(`${G}/users/${encodeURIComponent(BOX)}/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since} and from/emailAddress/address eq '${SENDER}'`)}&$select=id,subject,receivedDateTime,body&$top=30`, { headers: { Authorization: `Bearer ${tok}`, Prefer: 'outlook.body-content-type="text"' }, cache: 'no-store' })
  if (!r.ok) return out
  const mails: any[] = ((await r.json()).value || []).filter((m: any) => /A traiter/i.test(m.subject || ''))
  if (!mails.length) return out

  const sb = createAdminClient()
  const { data: s } = await sb.from('app_settings').select('value').eq('key', SEEN_KEY).maybeSingle()
  let seen: string[] = []
  try { seen = s?.value ? JSON.parse(s.value) : [] } catch { seen = [] }

  for (const m of mails) {
    const ref = String(m.subject).match(/Mail IMA\s*-\s*([A-Z0-9]+)\s*-/i)?.[1]
    if (!ref || seen.includes(ref)) continue
    if (Date.now() - new Date(m.receivedDateTime).getTime() < GRACE_MS) continue
    out.checked++
    const text = String(m.body?.content || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ')
    const plate = field(text, 'Immatriculation').replace(/\s/g, '').toUpperCase()
    const { data: hit } = await sb.from('incoming_missions').select('id').or(`dossier_number.eq.${ref}${plate ? `,vehicle_plate.eq.${plate}` : ''}`).gte('created_at', new Date(new Date(m.receivedDateTime).getTime() - 3600_000).toISOString()).limit(1)
    if (hit?.length) { seen.push(ref); continue }
    const vehicule = [field(text, 'Marque'), field(text, 'Modèle')].filter(Boolean).join(' ')
    const depart = field(text, 'Adresse de depart'), arrivee = field(text, "Adresse d'arrivée"), heure = field(text, 'Date de départ prévue'), moyen = field(text, 'Moyen')
    try {
      const { sendNotificationToRoles } = await import('@/lib/notifications/send')
      await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'kaze_proposal_missing', {
        title: `⚠️ IMA ${ref} : proposition absente de VD Soft`,
        body: `${moyen || 'Mission'} ${vehicule} ${plate} — ${depart}${arrivee ? ` → ${arrivee}` : ''}${heure ? ` (départ prévu ${heure})` : ''}. Kaze ne l'a pas transmise : accepte-la directement dans Kaze, la fiche se créera à l'affectation.`.replace(/\s+/g, ' ').trim(),
        action_url: 'https://app.kaze.so',
      } as any)
      out.alerted.push(ref)
      seen.push(ref)
    } catch (e: any) { console.error('[kaze proposal-watch] alerte KO :', e?.message) }
  }
  await sb.from('app_settings').upsert({ key: SEEN_KEY, value: JSON.stringify(seen.slice(-100)) }, { onConflict: 'key' })
  return out
}

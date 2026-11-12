// src/lib/axa/mfa-code.ts
//
// Code de connexion go&assist (Olivier 11/11/2026). Depuis ce jour, AXA envoie
// un code à 6 chiffres par mail à chaque connexion au portail. La reconnexion
// automatique le lit dans la boîte du compte (réglage axa_codes_boite), en ne
// regardant QUE les mails de l'expéditeur AXA (axa_codes_expediteur) reçus après
// la demande. Rien d'autre de la boîte n'est lu.

import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getBusinessText } from '@/lib/settings/business'

const CODE_RE = /code\s+is\s*:?\s*(\d{6})\b/i

async function graphGet(url: string): Promise<any> {
  let tok = await getAppOnlyToken()
  let r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
  if (r.status === 401) {
    tok = await getAppOnlyToken(true)
    r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
  }
  if (!r.ok) throw new Error(`lecture des codes AXA impossible (${r.status})`)
  return r.json()
}

/** Code reçu après `sinceMs` (le plus récent), ou null. */
export async function findAxaMfaCode(sinceMs: number): Promise<string | null> {
  const box = await getBusinessText('axa_codes_boite')
  const from = (await getBusinessText('axa_codes_expediteur')).toLowerCase()
  const since = new Date(sinceMs).toISOString().replace(/\.\d+Z$/, 'Z')
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box)}/messages`
    + `?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`
    + `&$select=receivedDateTime,from,subject,body&$orderby=receivedDateTime desc&$top=25`
  const j = await graphGet(url)
  for (const m of j?.value || []) {
    if ((m.from?.emailAddress?.address || '').toLowerCase() !== from) continue
    const text = String(m.body?.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    const hit = text.match(CODE_RE) || String(m.subject || '').match(CODE_RE)
    if (hit) return hit[1]
  }
  return null
}

/** Attend le code jusqu'à `timeoutMs` (relecture toutes les 5 s). */
export async function waitAxaMfaCode(sinceMs: number, timeoutMs = 120_000): Promise<string | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const c = await findAxaMfaCode(sinceMs).catch(() => null)
    if (c) return c
    await new Promise(r => setTimeout(r, 5000))
  }
  return null
}

/**
 * Connexion établie : supprime de la boîte les mails de code AXA reçus depuis
 * `sinceMs` (le code ne resservira jamais ; Olivier 12/11/2026 : la boîte ne
 * doit pas se remplir de codes). Seuls les mails de l'expéditeur AXA qui
 * contiennent un code sont supprimés. Renvoie le nombre supprimé ; jamais bloquant.
 */
export async function deleteAxaMfaMails(sinceMs: number): Promise<number> {
  const box = await getBusinessText('axa_codes_boite')
  const from = (await getBusinessText('axa_codes_expediteur')).toLowerCase()
  if (!box || !from) return 0
  const since = new Date(sinceMs).toISOString().replace(/\.\d+Z$/, 'Z')
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box)}/messages`
  const j = await graphGet(`${base}?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$select=id,from,subject,body&$top=50`)
  let n = 0
  for (const m of j?.value || []) {
    if ((m.from?.emailAddress?.address || '').toLowerCase() !== from) continue
    const text = String(m.body?.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    if (!CODE_RE.test(text) && !CODE_RE.test(String(m.subject || ''))) continue
    let tok = await getAppOnlyToken()
    let r = await fetch(`${base}/${encodeURIComponent(m.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
    if (r.status === 401) {
      tok = await getAppOnlyToken(true)
      r = await fetch(`${base}/${encodeURIComponent(m.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
    }
    if (r.ok) n++
  }
  return n
}

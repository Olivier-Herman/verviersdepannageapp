// src/lib/mail-agent/graph.ts
//
// Accès Graph pour l'agent mail : lire un DOSSIER Outlook précis (et pas la
// boîte de réception), lire le corps d'un message, le déplacer une fois traité.
//
// On réutilise getAppOnlyToken de graph-mail-search (app-only + Application
// Access Policy déjà en prod sur info/fourriere/administration) — pas de
// nouvelle app Azure, pas de nouvelle permission à demander.

import { getAppOnlyToken, isAllowedMailbox } from '@/lib/graph-mail-search'

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface AgentMessage {
  id:            string
  subject:       string
  fromEmail:     string
  fromName:      string
  receivedAt:    string
  bodyPreview:   string
  hasAttachments: boolean
  /** Destinataires directs — sert à écarter les mails où on est en simple copie. */
  toEmails:      string[]
  ccEmails:      string[]
}

/** fetch Graph authentifié, avec retry unique sur 401 (token expiré → refresh). */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getAppOnlyToken()
  if (!token) throw new Error('Graph non configuré (AZURE_AD_* manquants)')
  const doFetch = (t: string) => fetch(`${GRAPH}${path}`, {
    ...init,
    // no-store : Next met en cache les GET serveur → réponses Graph gelées.
    cache: 'no-store',
    headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` },
  })
  let res = await doFetch(token)
  if (res.status === 401) {
    token = await getAppOnlyToken(true)
    if (!token) throw new Error('Graph non configuré')
    res = await doFetch(token)
  }
  return res
}

async function authedGet(path: string): Promise<any> {
  const res = await authedFetch(path)
  if (!res.ok) throw new Error(`Graph GET ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

function guardMailbox(mailbox: string) {
  // Même verrou que la recherche : on ne lit que les boîtes autorisées par la
  // policy Azure. Évite qu'une faute de frappe parte lire une autre mailbox.
  if (!isAllowedMailbox(mailbox)) throw new Error(`Mailbox non autorisée : ${mailbox}`)
}

/**
 * Retrouve un dossier Outlook par son nom affiché, y compris les sous-dossiers
 * de la boîte de réception (nos dossiers métier y vivent tous : « 0 - Jona et
 * Mobi », « RENT A CAR », « Mail auto-géré »…).
 */
export async function findFolderIdByName(mailbox: string, name: string): Promise<string | null> {
  guardMailbox(mailbox)
  const wanted = name.trim().toLowerCase()

  // Descente récursive : les dossiers métier ne sont pas tous au premier niveau.
  // « ima payement » vit sous Boîte de réception › IMA MISSION › ima payement,
  // soit 2 niveaux sous la racine — une recherche à plat le manquerait.
  const MAX_DEPTH = 4

  async function walk(path: string, depth: number): Promise<string | null> {
    const data = await authedGet(`${path}?$top=100&$select=id,displayName,childFolderCount`)
    const folders = data.value || []
    for (const f of folders) {
      if ((f.displayName || '').trim().toLowerCase() === wanted) return f.id
    }
    if (depth >= MAX_DEPTH) return null
    for (const f of folders) {
      if (!f.childFolderCount) continue
      const hit = await walk(`/users/${encodeURIComponent(mailbox)}/mailFolders/${f.id}/childFolders`, depth + 1)
      if (hit) return hit
    }
    return null
  }

  return walk(`/users/${encodeURIComponent(mailbox)}/mailFolders`, 0)
}

const person = (p: any) => ({
  name:  p?.emailAddress?.name || '',
  email: (p?.emailAddress?.address || '').toLowerCase(),
})

/** Liste les messages d'un dossier, du plus récent au plus ancien. */
export async function listFolderMessages(mailbox: string, folderId: string, top = 100): Promise<AgentMessage[]> {
  guardMailbox(mailbox)
  const url = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folderId}/messages`
    + `?$top=${top}&$orderby=receivedDateTime desc`
    + `&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments`
  const data = await authedGet(url)
  return (data.value || []).map((m: any) => ({
    id:             m.id,
    subject:        m.subject || '',
    fromEmail:      person(m.from).email,
    fromName:       person(m.from).name,
    receivedAt:     m.receivedDateTime || '',
    bodyPreview:    m.bodyPreview || '',
    hasAttachments: Boolean(m.hasAttachments),
    toEmails:       (m.toRecipients || []).map((x: any) => person(x).email).filter(Boolean),
    ccEmails:       (m.ccRecipients || []).map((x: any) => person(x).email).filter(Boolean),
  }))
}

/** Convertit un corps HTML en texte lisible — les mails IMA sont des gabarits HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|td|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:#39|rsquo|apos);/g, "'")
    .replace(/&(?:eacute|Eacute);/g, 'é')
    .replace(/&(?:egrave);/g, 'è')
    .replace(/&[a-z]+;/gi, ' ')
    .split('\n').map(s => s.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** Lit le corps complet d'un message, en texte. */
export async function getMessageText(mailbox: string, messageId: string): Promise<string> {
  guardMailbox(mailbox)
  const m = await authedGet(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}?$select=body`)
  const raw = m.body?.content || ''
  return m.body?.contentType === 'html' ? htmlToText(raw) : raw
}

/**
 * Déplace un message vers un dossier. Retourne ok:false plutôt que de lever :
 * un mail non déplacé ne doit JAMAIS annuler un traitement comptable déjà fait.
 */
export async function moveMessage(mailbox: string, messageId: string, folderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    guardMailbox(mailbox)
    const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/move`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ destinationId: folderId }),
    })
    if (!res.ok) return { ok: false, error: `Graph move ${res.status}: ${(await res.text()).slice(0, 200)}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

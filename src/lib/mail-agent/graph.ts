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

/** Tous les dossiers de la boîte (récursif), avec leur chemin lisible. */
export async function listAllFolders(mailbox: string): Promise<{ id: string; name: string; path: string }[]> {
  guardMailbox(mailbox)
  const out: { id: string; name: string; path: string }[] = []
  const walk = async (path: string, label: string, depth: number) => {
    if (depth > 6) return
    const j = await authedGet(`${path}?$top=200&$select=id,displayName,childFolderCount`)
    for (const f of j.value || []) {
      const p = `${label}/${f.displayName}`
      out.push({ id: f.id, name: String(f.displayName || ''), path: p })
      if (f.childFolderCount > 0) await walk(`/users/${encodeURIComponent(mailbox)}/mailFolders/${f.id}/childFolders`, p, depth + 1)
    }
  }
  await walk(`/users/${encodeURIComponent(mailbox)}/mailFolders`, '', 0)
  return out
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

/**
 * Comme findFolderIdByName, mais crée le dossier sous la Boîte de réception
 * s'il n'existe pas. Les dossiers de classement n'existaient que dans info@ :
 * « Classer » était refusé dans administration@ et fourriere@ et la carte
 * restait indéfiniment (Olivier 28/09/2026).
 */
export async function findOrCreateFolder(mailbox: string, name: string): Promise<string | null> {
  const found = await findFolderIdByName(mailbox, name)
  if (found) return found
  const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name.trim() }),
  })
  if (!res.ok) return null
  return (await res.json())?.id || null
}

const person = (p: any) => ({
  name:  p?.emailAddress?.name || '',
  email: (p?.emailAddress?.address || '').toLowerCase(),
})

/** Liste les messages d'un dossier, du plus récent au plus ancien. */
export async function listFolderMessages(mailbox: string, folderId: string, top = 100, sinceIso?: string): Promise<AgentMessage[]> {
  guardMailbox(mailbox)
  // `sinceIso` : ne lire que les mails reçus depuis cette date (scan incrémental
  // de toute la boîte — 185 dossiers, on ne relit pas 11 000 mails tous les
  // quarts d'heure).
  const filter = sinceIso ? `&$filter=receivedDateTime ge ${encodeURIComponent(sinceIso)}` : ''
  const url = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folderId}/messages`
    + `?$top=${top}&$orderby=receivedDateTime desc${filter}`
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

/** Récupère les pièces jointes PDF d'un message, en base64. */
export async function getPdfAttachments(mailbox: string, messageId: string): Promise<{ name: string; base64: string }[]> {
  guardMailbox(mailbox)
  const data = await authedGet(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`)
  return (data.value || [])
    .filter((a: any) => !a.isInline && a.contentBytes
      && (a.contentType === 'application/pdf' || /\.pdf$/i.test(a.name || '')))
    .map((a: any) => ({ name: a.name || 'document.pdf', base64: a.contentBytes }))
}

/**
 * Déplace un message vers un dossier. Retourne ok:false plutôt que de lever :
 * un mail non déplacé ne doit JAMAIS annuler un traitement comptable déjà fait.
 */
/** Transfère un mail (avec ses PJ) à une adresse — boîte d'encodage Odoo. */
export async function forwardMessage(mailbox: string, messageId: string, to: string, comment = ''): Promise<{ ok: boolean; error?: string }> {
  guardMailbox(mailbox)
  const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}/forward`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment, toRecipients: [{ emailAddress: { address: to } }] }),
  })
  if (res.status === 202) return { ok: true }
  return { ok: false, error: `Graph forward ${res.status}: ${(await res.text()).slice(0, 160)}` }
}

export async function moveMessage(mailbox: string, messageId: string, folderId: string): Promise<{ ok: boolean; error?: string; newId?: string }> {
  try {
    guardMailbox(mailbox)
    const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/move`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ destinationId: folderId }),
    })
    if (!res.ok) return { ok: false, error: `Graph move ${res.status}: ${(await res.text()).slice(0, 200)}` }
    // Le mail déplacé porte un NOUVEL identifiant Outlook.
    const moved = await res.json().catch(() => null)
    return { ok: true, newId: moved?.id || undefined }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Retrouve un mail dont l'identifiant a changé (déplacé à la main dans Outlook) :
 *  même expéditeur, même heure de réception (± 2 min), même sujet, dans toute la
 *  boîte. Olivier 29/09/2026 : « quand je tente de classer ce mail, il revient ». */
export async function relocateMessage(mailbox: string, m: { receivedAt: string; fromEmail: string; subject?: string | null }): Promise<string | null> {
  try {
    guardMailbox(mailbox)
    const t = new Date(m.receivedAt).getTime()
    const from = new Date(t - 120000).toISOString(), to = new Date(t + 120000).toISOString()
    const q = `/users/${encodeURIComponent(mailbox)}/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${from} and receivedDateTime le ${to}`)}&$select=id,subject,from,receivedDateTime&$top=50`
    const data = await authedGet(q)
    const norm = (s: string | null | undefined) => String(s || '').trim().toLowerCase()
    const hits = (data.value || []).filter((x: any) => norm(x.from?.emailAddress?.address) === norm(m.fromEmail))
    const best = hits.find((x: any) => !m.subject || norm(x.subject) === norm(m.subject)) || (hits.length === 1 ? hits[0] : null)
    return best?.id || null
  } catch { return null }
}

/** Brouillon (jamais envoyé) dans une boîte autorisée, avec pièces jointes.
 *  Module Courrier : réponses préparées dans administration@ (29/09/2026). */
export async function createDraftMail(mailbox: string, m: {
  to?: string | null; toName?: string | null; subject: string; html: string
  attachments?: { name: string; contentType: string; contentBytes: string }[]
}): Promise<{ ok: boolean; id?: string; webLink?: string; error?: string }> {
  try {
    guardMailbox(mailbox)
    const body: any = {
      subject: m.subject,
      body: { contentType: 'HTML', content: m.html },
      toRecipients: m.to ? [{ emailAddress: { address: m.to, name: m.toName || m.to } }] : [],
      attachments: (m.attachments || []).map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType, contentBytes: a.contentBytes })),
    }
    const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return { ok: false, error: `Graph ${res.status}: ${(await res.text()).slice(0, 200)}` }
    const j = await res.json()
    return { ok: true, id: j.id, webLink: j.webLink }
  } catch (e: any) { return { ok: false, error: e?.message || 'brouillon impossible' } }
}

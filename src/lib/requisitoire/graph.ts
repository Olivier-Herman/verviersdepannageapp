// src/lib/requisitoire/graph.ts
//
// Helpers Microsoft Graph pour lire une mailbox partagée (ex: fourriere@),
// récupérer les pièces jointes PDF, et tagger un mail comme traité.
//
// Réutilise l'app Azure AD déjà autorisée sur les 3 mailboxes (info /
// fourriere / administration) via [graph-mail-search.ts] — même token
// app-only (client_credentials), donc fourriere@ est déjà accessible.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { getAppOnlyToken } from '@/lib/graph-mail-search'

const GRAPH = 'https://graph.microsoft.com/v1.0'

// Catégorie Outlook posée sur les mails de réquisitoire traités (dedup défensif,
// + « classement » visuel du mail dans la boîte).
export const REQUISITOIRE_CATEGORY = 'VD Soft - Réquisitoire traité'

export interface GraphMessage {
  id:               string
  subject:          string
  from:             string
  receivedDateTime: string
  categories:       string[]
  hasAttachments:   boolean
  bodyPreview:      string
}

export interface GraphPdfAttachment {
  name:         string
  contentType:  string
  contentBytes: string   // base64
}

async function graphGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph GET ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Liste les derniers messages de la boîte de réception d'une mailbox. */
export async function listInboxMessages(mailbox: string, top = 25): Promise<GraphMessage[]> {
  const token = await getAppOnlyToken()
  if (!token) throw new Error('Graph non configuré (AZURE_AD_* manquants)')
  const data = await graphGet(
    token,
    `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages` +
    `?$top=${top}&$select=id,subject,from,receivedDateTime,categories,hasAttachments,bodyPreview` +
    `&$orderby=receivedDateTime desc`,
  )
  return (data.value || []).map((m: any) => ({
    id:               m.id,
    subject:          m.subject || '',
    from:             m.from?.emailAddress?.address || '',
    receivedDateTime: m.receivedDateTime,
    categories:       Array.isArray(m.categories) ? m.categories : [],
    hasAttachments:   Boolean(m.hasAttachments),
    bodyPreview:      m.bodyPreview || '',
  }))
}

export interface GraphMessageBody {
  subject:          string
  from:             string
  receivedDateTime: string
  contentType:      'html' | 'text'
  content:          string   // corps (html ou texte selon contentType)
}

/** Récupère le corps complet d'un message (pour les levées sans pièce jointe). */
export async function getMessageBody(mailbox: string, messageId: string): Promise<GraphMessageBody> {
  const token = await getAppOnlyToken()
  if (!token) throw new Error('Graph non configuré')
  const m = await graphGet(
    token,
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}?$select=subject,from,receivedDateTime,body`,
  )
  return {
    subject:          m.subject || '',
    from:             m.from?.emailAddress?.address || '',
    receivedDateTime: m.receivedDateTime || '',
    contentType:      (m.body?.contentType || 'text').toLowerCase() === 'html' ? 'html' : 'text',
    content:          m.body?.content || '',
  }
}

/** Récupère les pièces jointes PDF (avec contentBytes) d'un message. */
export async function getPdfAttachments(mailbox: string, messageId: string): Promise<GraphPdfAttachment[]> {
  const token = await getAppOnlyToken()
  if (!token) throw new Error('Graph non configuré')
  const list = await graphGet(token, `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments`)
  const out: GraphPdfAttachment[] = []
  for (const att of list.value || []) {
    const name = String(att.name || '')
    const ctype = String(att.contentType || '')
    const isPdf = ctype.toLowerCase().includes('pdf') || name.toLowerCase().endsWith('.pdf')
    if (!isPdf) continue
    // fileAttachment porte déjà contentBytes ; sinon fetch individuel.
    let contentBytes: string | undefined = att.contentBytes
    if (!contentBytes) {
      const full = await graphGet(token, `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments/${att.id}`)
      contentBytes = full.contentBytes
    }
    if (contentBytes) out.push({ name, contentType: ctype || 'application/pdf', contentBytes })
  }
  return out
}

/** Ajoute une catégorie Outlook au message (préserve l'existant). Best-effort. */
export async function tagMessage(mailbox: string, messageId: string, category: string, existing: string[]): Promise<void> {
  if (existing.includes(category)) return
  const token = await getAppOnlyToken()
  if (!token) return
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ categories: [...existing, category] }),
  })
  if (!res.ok) console.warn(`[requisitoire] tag mail ${messageId} fail:`, res.status)
}

// Dossier Outlook où atterrissent les mails traités automatiquement.
export const AUTO_MANAGED_FOLDER = 'Mail auto-géré'

const folderIdCache = new Map<string, string>()  // clé: `${mailbox}|${name}`

/** Trouve (ou crée) un dossier de mail par nom et renvoie son id. */
async function ensureFolderId(token: string, mailbox: string, name: string): Promise<string> {
  const cacheKey = `${mailbox}|${name}`
  const cached = folderIdCache.get(cacheKey)
  if (cached) return cached

  const data = await graphGet(token, `/users/${encodeURIComponent(mailbox)}/mailFolders?$top=100&$select=id,displayName`)
  let folder = (data.value || []).find((f: any) => (f.displayName || '').toLowerCase() === name.toLowerCase())
  if (!folder) {
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ displayName: name }),
    })
    if (!res.ok) throw new Error(`create folder ${res.status}: ${(await res.text()).slice(0, 160)}`)
    folder = await res.json()
  }
  folderIdCache.set(cacheKey, folder.id)
  return folder.id
}

/**
 * Déplace un message vers un dossier (créé au besoin). Best-effort : renvoie
 * false sans lever si le déplacement échoue. Nécessite Mail.ReadWrite (déjà
 * utilisé par le tagging).
 */
export async function moveMessageToFolder(mailbox: string, messageId: string, folderName: string): Promise<boolean> {
  const token = await getAppOnlyToken()
  if (!token) return false
  try {
    const destId = await ensureFolderId(token, mailbox, folderName)
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${messageId}/move`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ destinationId: destId }),
    })
    if (!res.ok) { console.warn(`[requisitoire] move mail ${messageId} fail:`, res.status, (await res.text()).slice(0, 160)); return false }
    return true
  } catch (e: any) {
    console.warn(`[requisitoire] move mail ${messageId} error:`, e?.message)
    return false
  }
}

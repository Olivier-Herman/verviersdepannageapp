// src/lib/requisitoire/graph.ts
//
// Helpers Microsoft Graph pour lire une mailbox partagée (ex: fourriere@),
// récupérer les pièces jointes PDF, lire le corps d'un mail, tagger et déplacer.
//
// Réutilise l'app Azure AD déjà autorisée sur les 3 mailboxes via
// [graph-mail-search.ts] (même token app-only client_credentials).
//
// Tous les appels passent par authedFetch : sur un 401 (token expiré), on force
// un nouveau token et on réessaie une fois. Olivier 2026-07-01.

import { getAppOnlyToken } from '@/lib/graph-mail-search'

const GRAPH = 'https://graph.microsoft.com/v1.0'

// Catégorie Outlook posée sur les mails traités (dedup défensif + classement).
export const REQUISITOIRE_CATEGORY = 'VD Soft - Réquisitoire traité'
// Dossier Outlook où atterrissent les mails traités automatiquement.
export const AUTO_MANAGED_FOLDER = 'Mail auto-géré'

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

export interface GraphMessageBody {
  subject:          string
  from:             string
  receivedDateTime: string
  contentType:      'html' | 'text'
  content:          string
}

/** fetch Graph authentifié avec retry unique sur 401 (token expiré → refresh). */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getAppOnlyToken()
  if (!token) throw new Error('Graph non configuré (AZURE_AD_* manquants)')
  const doFetch = (t: string) => fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` },
  })
  let res = await doFetch(token)
  if (res.status === 401) {
    token = await getAppOnlyToken(true)   // force un nouveau token
    if (!token) throw new Error('Graph non configuré')
    res = await doFetch(token)
  }
  return res
}

async function authedGet(path: string): Promise<any> {
  const res = await authedFetch(path)
  if (!res.ok) throw new Error(`Graph GET ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Liste les derniers messages de la boîte de réception d'une mailbox. */
export async function listInboxMessages(mailbox: string, top = 25): Promise<GraphMessage[]> {
  const data = await authedGet(
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

/** Récupère le corps complet d'un message (pour les levées sans pièce jointe). */
export async function getMessageBody(mailbox: string, messageId: string): Promise<GraphMessageBody> {
  const m = await authedGet(
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
  const list = await authedGet(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments`)
  const out: GraphPdfAttachment[] = []
  for (const att of list.value || []) {
    const name = String(att.name || '')
    const ctype = String(att.contentType || '')
    const isPdf = ctype.toLowerCase().includes('pdf') || name.toLowerCase().endsWith('.pdf')
    if (!isPdf) continue
    let contentBytes: string | undefined = att.contentBytes
    if (!contentBytes) {
      const full = await authedGet(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments/${att.id}`)
      contentBytes = full.contentBytes
    }
    if (contentBytes) out.push({ name, contentType: ctype || 'application/pdf', contentBytes })
  }
  return out
}

/** Ajoute une catégorie Outlook au message (préserve l'existant). Best-effort. */
export async function tagMessage(mailbox: string, messageId: string, category: string, existing: string[]): Promise<void> {
  if (existing.includes(category)) return
  const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ categories: [...existing, category] }),
  })
  if (!res.ok) console.warn(`[requisitoire] tag mail ${messageId} fail:`, res.status)
}

const folderIdCache = new Map<string, string>()  // clé: `${mailbox}|${name}`

/**
 * Trouve (ou crée) un dossier de mail par nom et renvoie son id.
 * Cherche d'abord SOUS la boîte de réception (là où l'utilisateur crée
 * généralement ses dossiers, et d'où viennent les mails), puis À LA RACINE.
 * Si introuvable, le crée SOUS la boîte de réception (emplacement visible).
 */
async function ensureFolderId(mailbox: string, name: string): Promise<string> {
  const cacheKey = `${mailbox}|${name}`
  const cached = folderIdCache.get(cacheKey)
  if (cached) return cached

  const wanted = name.toLowerCase()
  const findIn = async (path: string): Promise<any | null> => {
    try {
      const d = await authedGet(path)
      return (d.value || []).find((f: any) => (f.displayName || '').toLowerCase() === wanted) || null
    } catch { return null }
  }

  // 1. Sous Inbox   2. À la racine
  let folder = await findIn(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders?$top=100&$select=id,displayName`)
  if (!folder) folder = await findIn(`/users/${encodeURIComponent(mailbox)}/mailFolders?$top=100&$select=id,displayName`)

  // 3. Créer sous Inbox
  if (!folder) {
    const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ displayName: name }),
    })
    if (!res.ok) throw new Error(`create folder ${res.status}: ${(await res.text()).slice(0, 160)}`)
    folder = await res.json()
  }
  folderIdCache.set(cacheKey, folder.id)
  return folder.id
}

/**
 * Diagnostic : teste l'accès Graph à une mailbox (token + lecture des dossiers +
 * écriture = création/recherche du dossier cible). Renvoie la cause exacte.
 */
export async function checkMailboxAccess(mailbox: string): Promise<Record<string, any>> {
  const out: Record<string, any> = { mailbox }
  const token = await getAppOnlyToken()
  out.token = !!token
  if (!token) { out.error = 'Pas de token (AZURE_AD_* manquants ?)'; return out }

  // Lecture des dossiers
  const r = await authedFetch(`/users/${encodeURIComponent(mailbox)}/mailFolders?$top=5&$select=id,displayName`)
  out.read = r.ok ? 'ok' : `${r.status} ${(await r.text()).slice(0, 240)}`

  // ÉCRITURE RÉELLE : créer un dossier de test unique (que le compte n'a pas déjà),
  // puis le supprimer. C'est le vrai test des droits d'écriture (= déplacement).
  const testName = `VDSoft-test-${Date.now()}`
  const cr = await authedFetch(`/users/${encodeURIComponent(mailbox)}/mailFolders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: testName }),
  })
  if (cr.ok) {
    out.write = 'ok'
    const folder = await cr.json().catch(() => null)
    if (folder?.id) {
      const del = await authedFetch(`/users/${encodeURIComponent(mailbox)}/mailFolders/${folder.id}`, { method: 'DELETE' })
      out.write_cleanup = del.ok ? 'ok' : `${del.status}`
    }
  } else {
    out.write = `${cr.status} ${(await cr.text()).slice(0, 240)}`
  }

  // Où se trouve/se trouvent le(s) dossier(s) « Mail auto-géré » ? (racine + sous Inbox)
  const found: any[] = []
  const scan = async (loc: string, path: string) => {
    try {
      const d = await authedGet(path)
      for (const f of d.value || []) {
        if ((f.displayName || '').toLowerCase() === AUTO_MANAGED_FOLDER.toLowerCase()) {
          found.push({ location: loc, id: f.id, items: f.totalItemCount })
        }
      }
    } catch { /* ignore */ }
  }
  await scan('racine', `/users/${encodeURIComponent(mailbox)}/mailFolders?$top=100&$select=id,displayName,totalItemCount`)
  await scan('sous Inbox', `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders?$top=100&$select=id,displayName,totalItemCount`)
  out.auto_folders = found
  return out
}

/** Déplace un message vers un dossier (créé au besoin). Best-effort. */
export async function moveMessageToFolder(mailbox: string, messageId: string, folderName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const destId = await ensureFolderId(mailbox, folderName)
    const res = await authedFetch(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}/move`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ destinationId: destId }),
    })
    if (!res.ok) {
      const detail = `${res.status} ${(await res.text()).slice(0, 160)}`
      console.warn(`[requisitoire] move mail ${messageId} fail:`, detail)
      return { ok: false, error: detail }
    }
    return { ok: true }
  } catch (e: any) {
    console.warn(`[requisitoire] move mail ${messageId} error:`, e?.message)
    return { ok: false, error: e?.message || 'erreur' }
  }
}

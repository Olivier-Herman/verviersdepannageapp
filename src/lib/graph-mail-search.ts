// src/lib/graph-mail-search.ts
//
// Recherche d emails dans des mailboxes M365 partagees via Microsoft Graph
// (app-only / client_credentials). Utilise par /api/search pour etendre la
// recherche globale aux 3 boites info / fourriere / administration.
//
// Architecture : Option B (App registration + Application Access Policy).
// Une seule app Azure AD, restreinte par policy aux 3 mailboxes cibles.
//
// Env vars requises (deja configurees pour l envoi d emails et NextAuth) :
//   AZURE_AD_TENANT_ID
//   AZURE_AD_CLIENT_ID
//   AZURE_AD_CLIENT_SECRET
//
// L app Azure doit avoir la permission Microsoft Graph application
// Mail.Read (ou Mail.ReadWrite). Et une Application Access Policy doit
// restreindre l app aux 3 mailboxes cibles (sinon par defaut elle aurait
// acces a toutes les mailboxes du tenant).
//
// Si une env var est absente, la recherche email est desactivee
// silencieusement (no-op).

// 50 min : Azure émet des jetons de 60 à 65 min. On garde 10 min de marge
// plutôt que 5 — un cron lent ne doit pas se retrouver avec un jeton périmé
// en cours de route. La reprise sur 401 couvre le reste.
const TOKEN_TTL_MS = 50 * 60 * 1000

let cachedToken: { value: string; expiresAt: number } | null = null

export const SEARCH_MAILBOXES = [
  { email: 'info@verviersdepannage.com',           label: 'Info',           category: 'email_info'           as const },
  { email: 'fourriere@verviersdepannage.be',       label: 'Fourrière',      category: 'email_fourriere'      as const },
  { email: 'administration@verviersdepannage.com', label: 'Administration', category: 'email_administration' as const },
]

export type MailboxCategory = typeof SEARCH_MAILBOXES[number]['category']

export interface MailHit {
  category:        MailboxCategory
  mailboxLabel:    string
  id:              string
  subject:         string
  from:            string                 // "Name <email>" ou juste email
  receivedAt:      string                 // ISO
  bodyPreview:     string
  webLink:         string                 // URL Outlook web
}

function readEnv() {
  const tenant = process.env.AZURE_AD_TENANT_ID
  const client = process.env.AZURE_AD_CLIENT_ID
  const secret = process.env.AZURE_AD_CLIENT_SECRET
  if (!tenant || !client || !secret) return null
  return { tenant, client, secret }
}

export function isGraphConfigured(): boolean {
  return readEnv() !== null
}

export async function getAppOnlyToken(forceRefresh = false): Promise<string | null> {
  const env = readEnv()
  if (!env) return null

  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value
  }

  const res = await fetch(`https://login.microsoftonline.com/${env.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.client,
      client_secret: env.secret,
      scope:         'https://graph.microsoft.com/.default',
      grant_type:    'client_credentials',
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[graph-mail] token fail:', res.status, text.slice(0, 300))
    return null
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = {
    value:     data.access_token,
    expiresAt: Date.now() + Math.min(TOKEN_TTL_MS, (data.expires_in - 300) * 1000),
  }
  return data.access_token
}

/**
 * Recherche dans UNE mailbox via Graph $search.
 * Retourne max `top` resultats. Si erreur (mailbox non accessible, query
 * vide), retourne array vide et log (non bloquant pour la recherche globale).
 */
export async function searchMailbox(opts: {
  mailbox: typeof SEARCH_MAILBOXES[number]
  query:   string
  top?:    number
}): Promise<MailHit[]> {
  const query = opts.query.trim()
  if (query.length < 2) return []

  const token = await getAppOnlyToken()
  if (!token) return []

  const top = Math.min(25, Math.max(1, opts.top ?? 10))

  // Graph $search exige les guillemets escapes et un Content-Type particulier
  // sur les requetes GET (consistency level: eventual).
  // Cf. https://learn.microsoft.com/graph/search-concept-messages
  const escapedQuery = query.replace(/"/g, '\\"')
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.mailbox.email)}/messages`)
  url.searchParams.set('$search', `"${escapedQuery}"`)
  url.searchParams.set('$top',    String(top))
  url.searchParams.set('$select', 'id,subject,from,receivedDateTime,bodyPreview,webLink')

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization:      `Bearer ${token}`,
        ConsistencyLevel:   'eventual',
      },
    })
  } catch (e: any) {
    console.error(`[graph-mail] fetch fail (${opts.mailbox.email}):`, e.message)
    return []
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[graph-mail] ${opts.mailbox.email} ${res.status}: ${text.slice(0, 300)}`)
    return []
  }

  const data = await res.json() as { value?: any[] }
  const hits: MailHit[] = []
  for (const m of data.value || []) {
    const fromAddr = m.from?.emailAddress?.address || ''
    const fromName = m.from?.emailAddress?.name    || ''
    const fromStr  = fromName && fromName !== fromAddr ? `${fromName} <${fromAddr}>` : fromAddr
    hits.push({
      category:     opts.mailbox.category,
      mailboxLabel: opts.mailbox.label,
      id:           m.id,
      subject:      m.subject || '(sans objet)',
      from:         fromStr || '—',
      receivedAt:   m.receivedDateTime || '',
      bodyPreview:  (m.bodyPreview || '').slice(0, 200),
      webLink:      m.webLink || '',
    })
  }
  return hits
}

/** Recherche en parallele dans les 3 mailboxes. Best-effort. */
export async function searchAllMailboxes(query: string, top = 6): Promise<MailHit[]> {
  if (!isGraphConfigured()) return []
  const results = await Promise.all(
    SEARCH_MAILBOXES.map(mb => searchMailbox({ mailbox: mb, query, top })),
  )
  return results.flat()
}

// ─────────────────────────────────────────────────────────────────────
// Lecture inline du contenu complet d un email + pieces jointes
// ─────────────────────────────────────────────────────────────────────

export interface MailAttachment {
  id:            string
  name:          string
  contentType:   string
  size:          number
  isInline:      boolean
  contentId?:    string
}

export interface MailFull {
  id:              string
  subject:         string
  from:            { name: string; email: string } | null
  to:              { name: string; email: string }[]
  cc:              { name: string; email: string }[]
  receivedAt:      string
  bodyContentType: 'html' | 'text'
  body:            string
  hasAttachments:  boolean
  attachments:     MailAttachment[]
  webLink:         string
}

/** Verifie que le mailbox demande fait bien partie de la liste autorisee. */
export function isAllowedMailbox(email: string): boolean {
  const lower = email.toLowerCase()
  return SEARCH_MAILBOXES.some(mb => mb.email.toLowerCase() === lower)
}

/** Lit le contenu complet d un email (avec pieces jointes metadata). */
export async function fetchMailFull(opts: {
  mailbox:   string
  messageId: string
}): Promise<MailFull | null> {
  if (!isAllowedMailbox(opts.mailbox)) {
    throw new Error(`Mailbox non autorisee : ${opts.mailbox}`)
  }
  const token = await getAppOnlyToken()
  if (!token) return null

  // 1. Recupere le message + attachments (metadata uniquement, pas le contenu)
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.mailbox)}/messages/${encodeURIComponent(opts.messageId)}`)
  url.searchParams.set('$select', 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,webLink')

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[graph-mail] fetchMailFull ${res.status}: ${text.slice(0, 300)}`)
    return null
  }
  const m = await res.json()

  // 2. Si pieces jointes : recupere la liste (id, name, size, contentType, isInline)
  let attachments: MailAttachment[] = []
  if (m.hasAttachments) {
    const attUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.mailbox)}/messages/${encodeURIComponent(opts.messageId)}/attachments?$select=id,name,contentType,size,isInline,contentId`
    const attRes = await fetch(attUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (attRes.ok) {
      const data = await attRes.json() as { value?: any[] }
      attachments = (data.value || []).map(a => ({
        id:          a.id,
        name:        a.name,
        contentType: a.contentType || 'application/octet-stream',
        size:        a.size || 0,
        isInline:    Boolean(a.isInline),
        contentId:   a.contentId || undefined,
      }))
    }
  }

  const parsePerson = (p: any) => p?.emailAddress ? ({
    name:  p.emailAddress.name  || '',
    email: p.emailAddress.address || '',
  }) : null

  return {
    id:              m.id,
    subject:         m.subject || '(sans objet)',
    from:            parsePerson(m.from),
    to:              (m.toRecipients || []).map(parsePerson).filter(Boolean) as any,
    cc:              (m.ccRecipients || []).map(parsePerson).filter(Boolean) as any,
    receivedAt:      m.receivedDateTime || '',
    bodyContentType: m.body?.contentType === 'html' ? 'html' : 'text',
    body:            m.body?.content || '',
    hasAttachments:  Boolean(m.hasAttachments),
    attachments,
    webLink:         m.webLink || '',
  }
}

/** Recupere le contenu binaire d une piece jointe. Retourne null si pas trouve. */
export async function fetchAttachmentBytes(opts: {
  mailbox:      string
  messageId:    string
  attachmentId: string
}): Promise<{ bytes: ArrayBuffer; name: string; contentType: string } | null> {
  if (!isAllowedMailbox(opts.mailbox)) {
    throw new Error(`Mailbox non autorisee : ${opts.mailbox}`)
  }
  const token = await getAppOnlyToken()
  if (!token) return null

  // /$value renvoie le contenu brut pour une FileAttachment
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.mailbox)}/messages/${encodeURIComponent(opts.messageId)}/attachments/${encodeURIComponent(opts.attachmentId)}`

  // D abord les metadata pour le nom/type
  const metaRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!metaRes.ok) return null
  const meta = await metaRes.json()

  // contentBytes est base64 dans l API Graph
  if (meta['@odata.type'] === '#microsoft.graph.fileAttachment' && meta.contentBytes) {
    const buf = Buffer.from(meta.contentBytes, 'base64')
    return {
      bytes:       buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      name:        meta.name || 'attachment',
      contentType: meta.contentType || 'application/octet-stream',
    }
  }

  // ItemAttachment ou ReferenceAttachment : non supporte pour V1
  return null
}

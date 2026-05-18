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

const TOKEN_TTL_MS = 55 * 60 * 1000  // 55 min (token Graph dure 1h)

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

async function getAppOnlyToken(): Promise<string | null> {
  const env = readEnv()
  if (!env) return null

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
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
    expiresAt: Date.now() + Math.min(TOKEN_TTL_MS, (data.expires_in - 60) * 1000),
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

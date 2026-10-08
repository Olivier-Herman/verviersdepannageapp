// src/lib/agents/comptable-mailbox.ts
//
// Accès à la boîte d'Olivier (mobi@) pour les échanges avec le cabinet
// comptable — décision d'Olivier du 05/10/2026, à respecter AVANT tout usage :
//   1. seul l'agent comptable (Victor depuis le 07/10/2026, Benoît avant) y touche ; tout autre agent est refusé et
//      journalisé. Olivier lui-même (sa session) passe aussi par ici ;
//   2. lecture limitée au dossier « Comptable THG » et, pour les mails envoyés,
//      aux seuls messages dont TOUS les destinataires sont du domaine du cabinet ;
//      rien d'autre de la boîte n'est jamais lu ni renvoyé ;
//   3. écriture (brouillon, envoi des pièces retrouvées) uniquement vers des
//      adresses du domaine du cabinet ; tout autre destinataire refusé ;
//   4. chaque accès journalisé (agent_journal).
// La boîte n'est PAS ajoutée à la liste générale de l'app (isAllowedMailbox) :
// aucun autre module ne peut l'atteindre.

import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getBusinessText } from '@/lib/settings/business'
import { journal, type AgentAccount } from './core'

const G = 'https://graph.microsoft.com/v1.0'
export const COMPTABLE_AGENT = 'Victor'

export type Actor = { kind: 'agent'; agent: AgentAccount } | { kind: 'mobi'; name: string }

async function cfg() {
  const [box, domain, folder] = await Promise.all([getBusinessText('agents_boite_comptable'), getBusinessText('agents_domaine_comptable'), getBusinessText('agents_dossier_comptable')])
  return { box: box.toLowerCase(), domain: domain.toLowerCase().replace(/^@/, ''), folder }
}

function who(a: Actor) { return a.kind === 'agent' ? a.agent.name : a.name }

/** Règle 1 : seul l'agent comptable (ou Olivier). Refus journalisé. */
async function guard(a: Actor, action: string) {
  if (a.kind === 'agent' && a.agent.name !== COMPTABLE_AGENT) {
    await journal({ agent: a.agent.name, action: 'boîte comptable refusée', detail: `${action} : réservé à ${COMPTABLE_AGENT}`, ok: false })
    throw new Error(`Accès refusé : la boîte des échanges avec le comptable est réservée à ${COMPTABLE_AGENT}.`)
  }
}

async function graph(path: string, init: RequestInit = {}) {
  let tok = await getAppOnlyToken()
  if (!tok) throw new Error('Microsoft 365 non configuré')
  const go = (t: string) => fetch(`${G}${path}`, { ...init, cache: 'no-store', headers: { ...(init.headers || {}), Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } })
  let r = await go(tok)
  if (r.status === 401) { tok = await getAppOnlyToken(true); if (tok) r = await go(tok) }
  return r
}

const addr = (p: any) => String(p?.emailAddress?.address || '').toLowerCase()
const inDomain = (email: string, domain: string) => email.endsWith(`@${domain}`)

async function folderId(box: string, name: string): Promise<string> {
  const r = await graph(`/users/${encodeURIComponent(box)}/mailFolders/inbox/childFolders?$top=100&$select=id,displayName`)
  if (!r.ok) throw new Error(`Boîte comptable inaccessible (${r.status})`)
  const f = ((await r.json()).value || []).find((x: any) => String(x.displayName).trim().toLowerCase() === name.trim().toLowerCase())
  if (!f) throw new Error(`Dossier « ${name} » introuvable dans la boîte comptable.`)
  return f.id
}

/** Règle 2 : liste du dossier du cabinet + mails envoyés exclusivement au cabinet. */
export async function listComptableMails(a: Actor, top = 30) {
  await guard(a, 'lecture')
  const { box, domain, folder } = await cfg()
  const sel = '$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,hasAttachments'
  const fid = await folderId(box, folder)
  const inbox = ((await (await graph(`/users/${encodeURIComponent(box)}/mailFolders/${fid}/messages?$top=${top}&$orderby=receivedDateTime desc&${sel}`)).json()).value || [])
  const sentRaw = ((await (await graph(`/users/${encodeURIComponent(box)}/mailFolders/sentitems/messages?$top=100&$orderby=sentDateTime desc&${sel}`)).json()).value || [])
  const sent = sentRaw.filter((m: any) => { const all = [...(m.toRecipients || []), ...(m.ccRecipients || [])].map(addr); return all.length > 0 && all.every(e => inDomain(e, domain)) }).slice(0, top)
  const map = (m: any, sens: 'reçu' | 'envoyé') => ({ id: m.id, sens, objet: m.subject, de: addr(m.from), a: (m.toRecipients || []).map(addr), date: m.receivedDateTime || m.sentDateTime, apercu: String(m.bodyPreview || '').slice(0, 300), pieces: !!m.hasAttachments })
  // Mails du cabinet arrivés dans info@ et administration@ (Olivier 07/10/2026 : Victor, contact unique de la
  // comptable) : seulement ceux dont l'EXPÉDITEUR est du domaine du cabinet ; rien d'autre de ces boîtes.
  const autres: any[] = []
  for (const b of ['info@verviersdepannage.com', 'administration@verviersdepannage.com']) {
    const r = await graph(`/users/${encodeURIComponent(b)}/messages?$search=${encodeURIComponent(`"from:${domain}"`)}&$top=${top}&${sel}`, { headers: { ConsistencyLevel: 'eventual' } })
    if (!r.ok) continue
    for (const m of (await r.json()).value || []) if (inDomain(addr(m.from), domain)) autres.push({ ...map(m, 'reçu'), boite: b })
  }
  await journal({ agent: who(a), action: 'boîte comptable : lecture', detail: `${inbox.length} reçus, ${sent.length} envoyés, ${autres.length} dans info@/administration@` })
  return [...inbox.map((m: any) => ({ ...map(m, 'reçu'), boite: box })), ...sent.map((m: any) => ({ ...map(m, 'envoyé'), boite: box })), ...autres]
}

/** Règle 3 : brouillon ou envoi uniquement vers le domaine du cabinet. */
export async function writeToComptable(a: Actor, m: { to: string[]; cc?: string[]; subject: string; html: string; attachments?: { name: string; contentType: string; contentBytes: string }[] }, send: boolean): Promise<{ id?: string }> {
  await guard(a, send ? 'envoi' : 'brouillon')
  const { box, domain } = await cfg()
  const all = [...m.to, ...(m.cc || [])].map(e => String(e).trim().toLowerCase())
  if (!all.length || all.some(e => !inDomain(e, domain))) {
    await journal({ agent: who(a), action: 'boîte comptable refusée', detail: `destinataire hors @${domain} : ${all.join(', ')}`, ok: false })
    throw new Error(`Destinataire refusé : seules les adresses @${domain} sont permises depuis cette boîte.`)
  }
  const msg = { subject: m.subject, body: { contentType: 'HTML', content: m.html }, toRecipients: m.to.map(address => ({ emailAddress: { address } })), ccRecipients: (m.cc || []).map(address => ({ emailAddress: { address } })), attachments: (m.attachments || []).map(x => ({ '@odata.type': '#microsoft.graph.fileAttachment', ...x })) }
  if (send) {
    const r = await graph(`/users/${encodeURIComponent(box)}/sendMail`, { method: 'POST', body: JSON.stringify({ message: msg, saveToSentItems: true }) })
    if (r.status !== 202) throw new Error(`Envoi refusé (${r.status}) : ${(await r.text()).slice(0, 160)}`)
    await journal({ agent: who(a), action: 'boîte comptable : envoi', detail: `${m.subject} → ${all.join(', ')}` })
    return {}
  }
  const r = await graph(`/users/${encodeURIComponent(box)}/messages`, { method: 'POST', body: JSON.stringify(msg) })
  if (r.status !== 201) throw new Error(`Brouillon refusé (${r.status}) : ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  await journal({ agent: who(a), action: 'boîte comptable : brouillon', detail: `${m.subject} → ${all.join(', ')}` })
  return { id: j.id }
}

/**
 * Brouillon de RÉPONSE dans le fil d'un mail du cabinet reçu dans la boîte comptable (Victor,
 * Olivier 07/10/2026). Jamais envoyé : Olivier relit et envoie. Le mail d'origine doit venir du
 * domaine du cabinet ; la réponse ne part qu'à ce domaine (destinataires du fil filtrés).
 */
export async function draftReplyComptable(a: Actor, messageId: string, html: string, attachments: { name: string; contentType: string; contentBytes: string }[] = []): Promise<{ id: string }> {
  await guard(a, 'brouillon de réponse')
  const { box, domain } = await cfg()
  const r0 = await graph(`/users/${encodeURIComponent(box)}/messages/${encodeURIComponent(messageId)}?$select=id,from,subject`)
  if (!r0.ok) throw new Error('Mail d’origine introuvable dans la boîte comptable.')
  const orig = await r0.json()
  if (!inDomain(addr(orig.from), domain)) {
    await journal({ agent: who(a), action: 'boîte comptable refusée', detail: `réponse à un mail hors @${domain}`, ok: false })
    throw new Error(`Réponse refusée : le mail d'origine ne vient pas du cabinet (@${domain}).`)
  }
  // Réponse au seul expéditeur (du cabinet, vérifié ci-dessus), en UNE écriture : texte et pièces
  // posés à la création, plus rien ensuite (Olivier 08/10/2026, conflits Outlook).
  const { createReplyDraftOnce } = await import('@/lib/mail-agent/draft-once')
  const d = await createReplyDraftOnce(box, messageId, html, { attachments: attachments.slice(0, 20) })
  await journal({ agent: who(a), action: 'boîte comptable : brouillon de réponse', detail: `${orig.subject} · ${attachments.length} pièce(s)` })
  return { id: d.id }
}

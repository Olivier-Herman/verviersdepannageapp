// src/lib/mail-agent/draft-once.ts
//
// BROUILLON DE RÉPONSE EN UNE SEULE ÉCRITURE (Olivier 08/10/2026).
// Momo modifiait dans Outlook un brouillon préparé par un agent ; Outlook affichait « Une reconnexion
// a eu lieu… les modifications n'ont pas été conservées » et ses ajouts étaient perdus. Le brouillon
// était écrit en plusieurs fois (createReply, puis corps, puis expéditeur, puis chaque pièce jointe) :
// un Outlook en mode mis en cache peut garder une version intermédiaire et entrer en conflit.
//
// Ici : UN SEUL appel createReply portant le texte (`comment`, rendu en HTML, citation du mail
// d'origine ajoutée par Exchange), les destinataires, l'expéditeur et les pièces jointes. Ensuite,
// plus aucun agent ne touche au brouillon : on peut le modifier librement avant de l'envoyer.
// Pièces trop lourdes pour une seule requête : brouillon préparé dans un dossier caché, complété,
// puis déplacé UNE fois vers Brouillons (Outlook n'y voit qu'un élément terminé).

import { getAppOnlyToken } from '@/lib/graph-mail-search'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const INLINE_MAX = 2_800_000          // base64 cumulé : la requête Graph est plafonnée à ~4 Mo
const PREP_FOLDER = 'VD Soft - préparation'

export type DraftAttachment = { name: string; contentType: string; contentBytes: string }
type Recipient = { emailAddress: { address: string; name?: string } }

async function g(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getAppOnlyToken()
  if (!token) throw new Error('Graph non configuré')
  const go = (t: string) => fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), Authorization: `Bearer ${t}` },
  })
  let res = await go(token)
  if (res.status === 401) { token = await getAppOnlyToken(true); if (token) res = await go(token) }
  return res
}

const att = (a: DraftAttachment) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType, contentBytes: a.contentBytes })

async function prepFolderId(box: string): Promise<string | null> {
  const f = encodeURIComponent(`displayName eq '${PREP_FOLDER}'`)
  const j = await (await g(`/users/${encodeURIComponent(box)}/mailFolders?includeHiddenFolders=true&$filter=${f}&$select=id`)).json().catch(() => ({}))
  if (j?.value?.[0]?.id) return j.value[0].id
  const c = await g(`/users/${encodeURIComponent(box)}/mailFolders`, { method: 'POST', body: JSON.stringify({ displayName: PREP_FOLDER, isHidden: true }) })
  return c.ok ? (await c.json())?.id || null : null
}

async function addLargeAttachment(box: string, id: string, a: DraftAttachment): Promise<void> {
  const bytes = Buffer.from(a.contentBytes, 'base64')
  if (bytes.length < 3_000_000) {
    const r = await g(`/users/${encodeURIComponent(box)}/messages/${id}/attachments`, { method: 'POST', body: JSON.stringify(att(a)) })
    if (!r.ok) throw new Error(`pièce « ${a.name} » refusée (${r.status})`)
    return
  }
  const s = await g(`/users/${encodeURIComponent(box)}/messages/${id}/attachments/createUploadSession`, {
    method: 'POST', body: JSON.stringify({ AttachmentItem: { attachmentType: 'file', name: a.name, size: bytes.length, contentType: a.contentType } }),
  })
  if (!s.ok) throw new Error(`pièce « ${a.name} » : session refusée (${s.status})`)
  const url = (await s.json()).uploadUrl as string
  const CHUNK = 3 * 1024 * 1024
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const part = bytes.subarray(off, Math.min(off + CHUNK, bytes.length))
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${off}-${off + part.length - 1}/${bytes.length}`, 'Content-Type': 'application/octet-stream' }, body: part })
    if (!r.ok) throw new Error(`pièce « ${a.name} » : envoi refusé (${r.status})`)
  }
}

/**
 * Crée le brouillon de réponse au mail `messageId` de `mailbox`, en une écriture.
 * `to`/`cc` absents = destinataires de la réponse standard. `from` refusé par la boîte → brouillon
 * au nom de la boîte (`fromRefused`).
 */
export async function createReplyDraftOnce(mailbox: string, messageId: string, html: string, opts: {
  to?: Recipient[]; cc?: Recipient[]; from?: string | null; attachments?: DraftAttachment[]; replyAll?: boolean
} = {}): Promise<{ id: string; fromRefused: boolean }> {
  const box = encodeURIComponent(mailbox)
  const files = opts.attachments || []
  const total = files.reduce((n, a) => n + a.contentBytes.length, 0)
  const inline = total <= INLINE_MAX
  const message = (withFrom: boolean): any => {
    const m: any = {}
    if (opts.to) m.toRecipients = opts.to
    if (opts.cc) m.ccRecipients = opts.cc
    if (withFrom && opts.from && opts.from.toLowerCase() !== mailbox.toLowerCase()) m.from = { emailAddress: { address: opts.from } }
    if (inline && files.length) m.attachments = files.map(att)
    return m
  }
  const create = (withFrom: boolean) => g(`/users/${box}/messages/${encodeURIComponent(messageId)}/${opts.replyAll ? 'createReplyAll' : 'createReply'}`, {
    method: 'POST', body: JSON.stringify({ comment: html, message: message(withFrom) }),
  })
  let fromRefused = false
  let r = await create(true)
  if (r.status !== 201 && opts.from && opts.from.toLowerCase() !== mailbox.toLowerCase()) { fromRefused = true; r = await create(false) }
  if (r.status !== 201) throw new Error(`Répondre refusé (${r.status}) : ${(await r.text()).slice(0, 160)}`)
  let id: string = (await r.json()).id
  if (inline || !files.length) return { id, fromRefused }

  // Pièces lourdes : on termine le brouillon hors de vue, puis un seul déplacement vers Brouillons.
  const prep = await prepFolderId(mailbox)
  if (prep) {
    const mv = await g(`/users/${box}/messages/${id}/move`, { method: 'POST', body: JSON.stringify({ destinationId: prep }) })
    if (mv.ok) id = (await mv.json()).id || id
  }
  for (const a of files) await addLargeAttachment(mailbox, id, a)
  if (prep) {
    const back = await g(`/users/${box}/messages/${id}/move`, { method: 'POST', body: JSON.stringify({ destinationId: 'drafts' }) })
    if (back.ok) id = (await back.json()).id || id
  }
  return { id, fromRefused }
}

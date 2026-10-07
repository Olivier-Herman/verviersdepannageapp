// src/lib/mail-agent/pieces.ts
//
// Pièces réclamées (Olivier 06/10/2026, suivi complet validé le 07/10/2026). Quand nous demandons
// une pièce à un fournisseur (facture manquante, avis, remboursement…), la demande entre au
// registre : relevée dans nos mails envoyés, ou inscrite au moment de l'envoi (registerPieceRequest).
// L'agent mail reconnaît ensuite la réponse PAR RÈGLE : même fil de conversation, ou même
// expéditeur, quel que soit l'objet. Si elle porte la pièce : le circuit des factures fournisseurs
// l'encode, la demande passe « reçue », le point du dossier comptable passe « Réglé » avec le
// document, et Mobi est prévenu sur Telegram. Sans pièce (« la facture suit », question, refus) :
// le tri normal (IA) prépare une carte et Mobi est prévenu.
// Sans réponse : à J+7, un brouillon de relance dans le fil, présenté à Mobi (rien ne part seul) ;
// à J+14, escalade à Mobi.

import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getBusinessNumber } from '@/lib/settings/business'
import { tgSend } from '@/lib/sam/telegram'
import { addDoc, updatePoint } from '@/lib/compta/dossier'

const G = 'https://graph.microsoft.com/v1.0'
const REQUEST_SUBJECT = /demande de copie|copie compl[èe]te|pi[èe]ce(s)? manquante|document(s)? manquant|facture compl[èe]te|facture d[ée]finitive|demande de (la |votre )?facture|avis d.[ée]ch[ée]ance|demande de remboursement|rechnung angefordert|merci de nous (faire parvenir|envoyer|transmettre)|pourriez-vous nous (en )?(envoyer|transmettre|renvoyer|adresser)/i
const OURS = /verviers-?depannage|thg\.be|hoos/i
const DAY = 86_400_000
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' })

async function telegramMobi(text: string): Promise<void> {
  try { await tgSend(await getBusinessNumber('telegram_chat_mobi'), text, [], 'Pièces réclamées') } catch { /* jamais bloquant */ }
}
async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  const call = (tok: string | null) => fetch(`${G}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, cache: 'no-store' })
  let r = await call(await getAppOnlyToken())
  if (r.status === 401) r = await call(await getAppOnlyToken(true))
  return r
}

export interface PieceRequestInput {
  mailbox: string; messageId: string; emails: string[]; subject: string; sentAt: string; conversationId?: string | null
  companyId?: number | null; fournisseur?: string | null; reference?: string | null; dossierPointId?: string | null
}
/** Inscrit une demande au registre au moment de l'envoi (agents, sessions). Idempotent par message. */
export async function registerPieceRequest(sb: any, d: PieceRequestInput): Promise<void> {
  await sb.from('mail_piece_requests').upsert({
    message_id: d.messageId, mailbox: d.mailbox, emails: d.emails.map(e => e.toLowerCase()), subject: d.subject.slice(0, 300), requested_at: d.sentAt,
    conversation_id: d.conversationId || null, company_id: d.companyId ?? null, fournisseur: d.fournisseur || null, reference: d.reference || null, dossier_point_id: d.dossierPointId || null,
  }, { onConflict: 'message_id' })
}

/** Relève nos demandes de pièces envoyées ces 3 derniers jours (idempotent : une ligne par message). */
export async function scanPieceRequests(sb: any, mailbox: string): Promise<number> {
  const since = new Date(Date.now() - 3 * DAY).toISOString()
  const r = await graph(`/users/${encodeURIComponent(mailbox)}/mailFolders/sentitems/messages?$filter=${encodeURIComponent(`sentDateTime ge ${since}`)}&$top=100&$select=id,subject,toRecipients,ccRecipients,sentDateTime,bodyPreview,conversationId`)
  if (!r.ok) return 0
  const j: any = await r.json()
  let n = 0
  for (const m of j.value || []) {
    if (!REQUEST_SUBJECT.test(`${m.subject || ''} ${m.bodyPreview || ''}`)) continue
    const to = [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((x: any) => String(x.emailAddress?.address || '').toLowerCase()).filter((e: string) => e && !OURS.test(e))
    if (!to.length) continue
    const { error } = await sb.from('mail_piece_requests').upsert({ message_id: m.id, mailbox, emails: to, subject: String(m.subject || '').slice(0, 300), requested_at: m.sentDateTime, conversation_id: m.conversationId || null }, { onConflict: 'message_id', ignoreDuplicates: true })
    if (!error) n++
  }
  return n
}

/** Adresses dont on attend une pièce (demandes ouvertes). */
export async function loadWatchedSenders(sb: any): Promise<string[]> {
  const { data } = await sb.from('mail_piece_requests').select('emails').eq('status', 'open')
  return [...new Set((data || []).flatMap((x: any) => x.emails || []))] as string[]
}
/** Fils de conversation de nos demandes ouvertes. */
export async function loadWatchedConversations(sb: any): Promise<string[]> {
  const { data } = await sb.from('mail_piece_requests').select('conversation_id').eq('status', 'open').not('conversation_id', 'is', null)
  return [...new Set((data || []).map((x: any) => x.conversation_id))] as string[]
}

async function openRequestsFor(sb: any, fromEmail: string, conversationId?: string): Promise<any[]> {
  const e = (fromEmail || '').toLowerCase()
  if (conversationId) {
    const { data } = await sb.from('mail_piece_requests').select('*').eq('status', 'open').eq('conversation_id', conversationId)
    if (data?.length) return data
  }
  if (!e) return []
  const { data } = await sb.from('mail_piece_requests').select('*').eq('status', 'open').contains('emails', [e])
  return data || []
}

async function pdfAttachments(mailbox: string, messageId: string): Promise<{ name: string; bytes: Buffer }[]> {
  const r = await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`)
  if (!r.ok) return []
  const j: any = await r.json()
  return (j.value || []).filter((a: any) => /\.pdf$/i.test(a.name || '') && a.contentBytes).map((a: any) => ({ name: a.name, bytes: Buffer.from(a.contentBytes, 'base64') }))
}

/**
 * Réponse portant la pièce (le circuit fournisseur l'a encodée ou mise à vérifier) : la demande
 * passe « reçue », le point du dossier comptable passe « Réglé » avec les PDF, Mobi est prévenu.
 */
export async function markPieceReceived(sb: any, fromEmail: string, via: string, ctx?: { mailbox: string; messageId: string; conversationId?: string; subject?: string }): Promise<void> {
  const reqs = await openRequestsFor(sb, fromEmail, ctx?.conversationId)
  if (!reqs.length) return
  const now = new Date().toISOString()
  let pdfs: { name: string; bytes: Buffer }[] | null = null
  for (const q of reqs) {
    const { data: won } = await sb.from('mail_piece_requests').update({ status: 'received', received_at: now, received_via: via.slice(0, 300), last_reply_at: now }).eq('id', q.id).eq('status', 'open').select('id')
    if (!won?.length) continue
    let doss = ''
    if (q.dossier_point_id && ctx) {
      try {
        pdfs ??= await pdfAttachments(ctx.mailbox, ctx.messageId)
        for (const p of pdfs) await addDoc(q.dossier_point_id, p.name, p.bytes)
        await updatePoint(q.dossier_point_id, { etat: 'regle', suivi: `Pièce reçue le ${ddmm(now)}` }, `Pièce reçue du fournisseur le ${ddmm(now)}${pdfs.length ? ` (${pdfs.map(p => p.name).join(', ')})` : ''}.`)
        doss = '\nLe point du dossier comptable est passé « Réglé » avec la pièce.'
      } catch (e: any) { doss = `\n⚠ Dossier comptable non mis à jour : ${e?.message || e}` }
    }
    await telegramMobi(`📎 Pièce reçue — ${q.fournisseur || fromEmail}\n« ${q.subject} »\nRéponse : « ${ctx?.subject || via} ».${doss}\nElle passe dans le circuit des factures fournisseurs (brouillon à valider).`)
  }
}

/** Réponse d'un fournisseur surveillé SANS pièce : le tri normal prépare la carte ; Mobi est prévenu. */
const BOUNCE_FROM = /^(postmaster|mailer-daemon|microsoftexchange[^@]*)@/i
const BOUNCE_SUBJECT = /^(non remis|undeliverable|unzustellbar|onbestelbaar|delivery status notification|mail delivery failed)/i

export async function notePieceReplyWithoutDocument(sb: any, fromEmail: string, ctx: { conversationId?: string; subject?: string; preview?: string }): Promise<void> {
  const reqs = await openRequestsFor(sb, fromEmail, ctx.conversationId)
  // Avis de non-remise (adresse inconnue…) : ce n'est pas une réponse du fournisseur. On le dit tel quel
  // (L'Universelle, 07/10/2026 : l'avis « Non remis » avait été annoncé comme une réponse sans pièce).
  const bounce = BOUNCE_FROM.test(fromEmail || '') || BOUNCE_SUBJECT.test(ctx.subject || '')
  for (const q of reqs) {
    if (bounce) {
      if (q.last_reply_at) continue
      await sb.from('mail_piece_requests').update({ last_reply_at: new Date().toISOString(), received_via: 'NON REMIS : adresse refusée par le serveur du fournisseur' }).eq('id', q.id)
      await telegramMobi(`⚠️ Demande NON REMISE — ${q.fournisseur || (q.emails || []).join(', ')}
« ${q.subject} »
L'adresse ${(q.emails || []).join(', ')} est refusée par leur serveur. Il faut une autre adresse : la demande reste ouverte.`)
      continue
    }
    if (q.last_reply_at && Date.now() - new Date(q.last_reply_at).getTime() < 3600_000) continue   // une seule alerte par réponse
    await sb.from('mail_piece_requests').update({ last_reply_at: new Date().toISOString() }).eq('id', q.id)
    await telegramMobi(`✉️ Réponse sans pièce — ${q.fournisseur || fromEmail}\n« ${q.subject} »\n${(ctx.preview || '').slice(0, 400)}\nUne carte est préparée dans l'agent mail.`)
  }
}

/**
 * Sans réponse : J+7 → brouillon de relance dans le fil de la demande (jamais envoyé seul) et
 * alerte Telegram ; J+14 → escalade à Mobi. Une seule fois chacune.
 */
export async function remindOldPieceRequests(sb: any): Promise<void> {
  const j7 = new Date(Date.now() - 7 * DAY).toISOString()
  const { data } = await sb.from('mail_piece_requests').select('*').eq('status', 'open').is('relanced_at', null).lte('requested_at', j7).limit(20)
  for (const q of data || []) {
    const { data: won } = await sb.from('mail_piece_requests').update({ relanced_at: new Date().toISOString() }).eq('id', q.id).is('relanced_at', null).select('id')
    if (!won?.length) continue
    let draftId: string | null = null
    try {
      const d: any = await (await graph(`/users/${encodeURIComponent(q.mailbox)}/messages/${encodeURIComponent(q.message_id)}/createReply`, { method: 'POST', body: '{}' })).json()
      if (d?.id) {
        const de = /rechnung|zahlung/i.test(q.subject || '')
        const txt = de
          ? `<p>Sehr geehrte Damen und Herren,</p><p>wir erlauben uns, auf unsere Anfrage vom ${ddmm(q.requested_at)} zurückzukommen, auf die wir noch keine Antwort erhalten haben. Wir wären Ihnen für eine kurze Rückmeldung dankbar.</p><p>Mit freundlichen Grüßen</p><p>Verwaltung<br>Verviers Dépannage SA</p>`
          : `<p>Madame, Monsieur,</p><p>Nous nous permettons de revenir vers vous au sujet de notre demande du ${ddmm(q.requested_at)}, restée sans réponse à ce jour. Nous vous remercions d'avance pour votre retour.</p><p>Avec nos remerciements,</p><p>Service administratif<br>Verviers Dépannage SA</p>`
        await graph(`/users/${encodeURIComponent(q.mailbox)}/messages/${d.id}`, { method: 'PATCH', body: JSON.stringify({ body: { contentType: 'HTML', content: txt + '<hr>' + (d.body?.content || '') } }) })
        draftId = d.id
      }
    } catch { /* la relance reste signalée même sans brouillon */ }
    await sb.from('mail_piece_requests').update({ relance_draft_id: draftId }).eq('id', q.id)
    await telegramMobi(`⏰ Relance à envoyer — ${q.fournisseur || (q.emails || []).join(', ')}\n« ${q.subject} » (demandé le ${ddmm(q.requested_at)}, sans réponse).\n${draftId ? `Le brouillon de relance est prêt dans ${q.mailbox}, dans le fil de la demande.` : 'Brouillon non créé : relance à faire à la main.'}`)
  }
  const j14 = new Date(Date.now() - 14 * DAY).toISOString()
  const { data: late } = await sb.from('mail_piece_requests').select('*').eq('status', 'open').is('escalated_at', null).lte('requested_at', j14).limit(20)
  for (const q of late || []) {
    const { data: won } = await sb.from('mail_piece_requests').update({ escalated_at: new Date().toISOString() }).eq('id', q.id).is('escalated_at', null).select('id')
    if (!won?.length) continue
    await telegramMobi(`🚩 Toujours sans réponse après 14 jours — ${q.fournisseur || (q.emails || []).join(', ')}\n« ${q.subject} » (demandé le ${ddmm(q.requested_at)}${q.relanced_at ? `, relance préparée le ${ddmm(q.relanced_at)}` : ''}).\nÀ traiter autrement (téléphone, autre contact).`)
  }
}

// src/lib/mail-agent/pieces.ts
//
// Pièces réclamées en attente (Olivier 06/10/2026). Quand nous demandons une pièce à
// un fournisseur (copie complète d'une avance, facture manquante, avis…), la demande
// est relevée dans nos mails envoyés. L'agent surveille alors les réponses de ce
// correspondant QUEL QUE SOIT l'objet (Codra 05/10, RGF 28/09 : réponses « RE: »
// ratées). Sans réponse après 7 jours : rappel à Olivier.

import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getBusinessList } from '@/lib/settings/business'
import { sendPushToUsers } from '@/lib/push'

const G = 'https://graph.microsoft.com/v1.0'
const REQUEST_SUBJECT = /demande de copie|copie compl[èe]te|pi[èe]ce(s)? manquante|document(s)? manquant|facture compl[èe]te|demande de (la |votre )?facture|merci de nous (faire parvenir|envoyer|transmettre)|pourriez-vous nous (envoyer|transmettre|renvoyer)/i
const OURS = /verviers-?depannage|thg\.be|hoos/i

/** Relève nos demandes de pièces envoyées ces 3 derniers jours (idempotent : une ligne par message). */
export async function scanPieceRequests(sb: any, mailbox: string): Promise<number> {
  const tok = await getAppOnlyToken()
  if (!tok) return 0
  const since = new Date(Date.now() - 3 * 86400_000).toISOString()
  const r = await fetch(`${G}/users/${encodeURIComponent(mailbox)}/mailFolders/sentitems/messages?$filter=${encodeURIComponent(`sentDateTime ge ${since}`)}&$top=100&$select=id,subject,toRecipients,ccRecipients,sentDateTime,bodyPreview`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
  if (!r.ok) return 0
  const j: any = await r.json()
  let n = 0
  for (const m of j.value || []) {
    if (!REQUEST_SUBJECT.test(`${m.subject || ''} ${m.bodyPreview || ''}`)) continue
    const to = [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((x: any) => String(x.emailAddress?.address || '').toLowerCase()).filter((e: string) => e && !OURS.test(e))
    if (!to.length) continue
    const { error } = await sb.from('mail_piece_requests').upsert({ message_id: m.id, mailbox, emails: to, subject: String(m.subject || '').slice(0, 300), requested_at: m.sentDateTime }, { onConflict: 'message_id', ignoreDuplicates: true })
    if (!error) n++
  }
  return n
}

/** Adresses dont on attend une pièce (demandes ouvertes). */
export async function loadWatchedSenders(sb: any): Promise<string[]> {
  const { data } = await sb.from('mail_piece_requests').select('emails').eq('status', 'open')
  return [...new Set((data || []).flatMap((x: any) => x.emails || []))] as string[]
}

/** Une réponse traitée de ce correspondant solde ses demandes ouvertes. */
export async function markPieceReceived(sb: any, fromEmail: string, via: string): Promise<void> {
  const e = (fromEmail || '').toLowerCase()
  if (!e) return
  await sb.from('mail_piece_requests').update({ status: 'received', received_at: new Date().toISOString(), received_via: via.slice(0, 300) }).eq('status', 'open').contains('emails', [e])
}

/** Demandes sans réponse depuis 7 jours : un rappel à Olivier, une seule fois par demande. */
export async function remindOldPieceRequests(sb: any): Promise<void> {
  const limit = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data } = await sb.from('mail_piece_requests').select('id, emails, subject, requested_at').eq('status', 'open').is('reminded_at', null).lte('requested_at', limit).limit(20)
  if (!data?.length) return
  const users = await getBusinessList('nav_agents_user_ids').catch(() => [] as string[])
  for (const d of data) {
    const { data: won } = await sb.from('mail_piece_requests').update({ reminded_at: new Date().toISOString() }).eq('id', d.id).is('reminded_at', null).select('id')
    if (!won?.length || !users.length) continue
    await sendPushToUsers(users, { title: 'Pièce réclamée sans réponse', body: `Depuis le ${String(d.requested_at).slice(0, 10)} : « ${d.subject} » (${(d.emails || []).join(', ')})`, url: '/mail-agent', tag: `piece-${d.id}` }).catch(() => {})
  }
}

// src/lib/mail-agent/riga.ts
//
// Classement des mails de Dépannage Riga (Olivier 05/10/2026, « ok pour 1 et 2 ») :
// les mails Riga arrivés à la racine de la Boîte de réception d'info@ et
// d'administration@ vont dans le dossier « Dépannage Riga » de la même boîte,
// où Justine (agent HOOS dédié à Riga) les traite.
//   - Indice SÛR (TVA de Riga, nom complet, compte bancaire de Riga) → déplacé,
//     tracé, annulable (« Remettre dans la boîte de réception »).
//   - Facture fournisseur : seulement rangée ici. Dans administration@ (lue en
//     entier), le circuit des factures la reprend ensuite dans « Dépannage Riga » :
//     adressée à Riga → encodage Riga, elle y reste ; émise par Riga pour VD →
//     achat de VD, rangée dans « Fournisseur Divers ». Dans info@, pas de
//     transfert automatique : Justine la traite (une facture Riga → VD est
//     peut-être déjà créée entre sociétés dans l'ERP — risque de doublon).
//   - Indice DOUTEUX (le mot « Riga » seul) → rien ne bouge, carte « À vérifier ».
//   - Jamais : assistances, police, justice, nos propres boîtes ; jamais un mail
//     déjà classé dans un dossier (seulement la racine de la Boîte de réception).
// Dans info@, c'est la seule lecture de la Boîte de réception (le reste de
// l'agent ne lit que ses deux dossiers, règle du 23/09/2026).

import { createAdminClient } from '@/lib/supabase'
import { odooRpcCompany } from '@/lib/odoo'
import { listFolderMessages, getMessageText, findFolderIdByName, moveMessage, type AgentMessage } from './graph'
import { COMPANIES, NOT_SUPPLIER, RIGA_FOLDER } from './handlers/fournisseur'

export { RIGA_FOLDER }
export const RIGA_MAILBOXES = ['info@verviersdepannage.com', 'administration@verviersdepannage.com']
const SINCE_KEY = 'mail_agent_riga_since'

// Comptes bancaires de Riga, lus dans l'ERP (journaux de banque de la société 2).
let ibanCache: { at: number; list: string[] } | null = null
async function rigaIbans(): Promise<string[]> {
  if (ibanCache && Date.now() - ibanCache.at < 6 * 3600_000) return ibanCache.list
  let list: string[] = []
  try {
    const j: any[] = await odooRpcCompany(COMPANIES.riga.id, 'account.journal', 'search_read',
      [[['type', '=', 'bank'], ['company_id', '=', COMPANIES.riga.id]]], { fields: ['bank_acc_number'] })
    list = (j || []).map(x => String(x.bank_acc_number || '').replace(/\s/g, '').toUpperCase()).filter(x => x.length >= 12)
  } catch { /* ERP indisponible : TVA et nom suffisent */ }
  ibanCache = { at: Date.now(), list }
  return list
}

// Avis de non-remise et refus de l'ERP : ils citent l'adresse d'encodage Riga sans être des mails Riga.
const BOUNCE_SUBJECT = /^(non remis|non distribuable|undeliverable|delivery status notification|mail delivery failed|returned mail)/i
const BOUNCE_SENDER = /postmaster|mailer-daemon|@verviers-depannage\.odoo\.com$/i
function isBounce(msg: AgentMessage): boolean { return BOUNCE_SUBJECT.test(msg.subject || '') || BOUNCE_SENDER.test(msg.fromEmail || '') }

/** Indice Riga dans un texte : sûr (déplacement) ou douteux (carte). */
export function rigaHint(text: string, ibans: string[]): { sure: string | null; doubt: string | null } {
  const digits = COMPANIES.riga.vat.replace(/\D/g, '')                 // 0890464750
  const vatRe = new RegExp(`(?:^|\\D)${digits.slice(0, 4)}[\\s.]?${digits.slice(4, 7)}[\\s.]?${digits.slice(7)}(?:\\D|$)`)
  if (vatRe.test(text)) return { sure: 'numéro de TVA de Riga', doubt: null }
  if (/d[ée]pannage\s+riga\b|\briga\s+s\.?r\.?l\b|\briga\s+sprl\b/i.test(text)) return { sure: 'nom « Dépannage Riga »', doubt: null }
  const flat = text.replace(/\s/g, '').toUpperCase()
  if (ibans.some(i => flat.includes(i))) return { sure: 'compte bancaire de Riga', doubt: null }
  if (/\briga\b/i.test(text)) return { sure: null, doubt: 'le mot « Riga » apparaît, sans TVA, nom complet ni compte de Riga' }
  return { sure: null, doubt: null }
}

export interface RigaReport { checked: number; moved: number; doubtful: number; errors: string[] }

/** Classe les mails Riga arrivés depuis le dernier passage dans la Boîte de réception. */
export async function sortRigaInbox(mailbox: string): Promise<RigaReport> {
  const sb = createAdminClient()
  const rep: RigaReport = { checked: 0, moved: 0, doubtful: 0, errors: [] }
  const { data: st } = await sb.from('app_settings').select('value').eq('key', SINCE_KEY).maybeSingle()
  let marks: Record<string, string> = {}
  try { marks = st?.value ? JSON.parse(st.value) : {} } catch {}
  // Premier passage : deux jours en arrière. Ensuite : depuis le dernier mail vu (− 5 min).
  const since = marks[mailbox]
    ? new Date(new Date(marks[mailbox]).getTime() - 5 * 60_000).toISOString()
    : new Date(Date.now() - 2 * 86400_000).toISOString()
  const msgs = await listFolderMessages(mailbox, 'inbox', 100, since)
  const ibans = await rigaIbans()
  let folderId: string | null | undefined
  let newest = marks[mailbox] || since
  for (const msg of msgs) {
    try {
      if (msg.receivedAt > newest) newest = msg.receivedAt
      if (NOT_SUPPLIER.test(msg.fromEmail) || isBounce(msg)) continue
      rep.checked++
      const known = await sb.from('mail_agent_items').select('id').eq('mailbox', mailbox).eq('handler', 'riga')
        .eq('received_at', msg.receivedAt).eq('from_email', msg.fromEmail).limit(1).maybeSingle()
      if (known.data) continue
      const body = await getMessageText(mailbox, msg.id)
      const hint = rigaHint(`${msg.subject}\n${msg.fromName}\n${msg.fromEmail}\n${body}`, ibans)
      const base = { handler: 'riga', mailbox, message_id: msg.id, folder: 'Boîte de réception', received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() }
      if (hint.sure) {
        if (folderId === undefined) folderId = await findFolderIdByName(mailbox, RIGA_FOLDER)
        if (!folderId) { rep.errors.push(`Dossier « ${RIGA_FOLDER} » introuvable dans ${mailbox}`); return rep }
        const mv = await moveMessage(mailbox, msg.id, folderId)
        if (!mv.ok) { rep.errors.push(`${msg.subject} : ${mv.error}`); continue }
        await sb.from('mail_agent_items').upsert({ ...base, message_id: mv.newId || msg.id, folder: RIGA_FOLDER, status: 'applied', mail_moved: true,
          blocked_reason: `Classé dans « ${RIGA_FOLDER} » (indice : ${hint.sure})`, extracted: { riga: { hint: hint.sure, from: 'Boîte de réception', at: new Date().toISOString() } } },
          { onConflict: 'mailbox,message_id,handler' })
        rep.moved++
      } else if (hint.doubt) {
        await sb.from('mail_agent_items').upsert({ ...base, status: 'to_verify',
          blocked_reason: `Mail Riga ? ${hint.doubt}. À classer dans « ${RIGA_FOLDER} » ou à laisser.`, extracted: { riga: { doubt: hint.doubt } } },
          { onConflict: 'mailbox,message_id,handler' })
        rep.doubtful++
      }
    } catch (e: any) { rep.errors.push(`${msg.subject} : ${e?.message || String(e)}`) }
  }
  // Repère avancé seulement si tout s'est bien passé (sinon on relit au prochain passage).
  if (!rep.errors.length) {
    marks[mailbox] = newest
    await sb.from('app_settings').upsert({ key: SINCE_KEY, value: JSON.stringify(marks), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  }
  return rep
}

export async function sortRigaMailboxes(): Promise<RigaReport> {
  const total: RigaReport = { checked: 0, moved: 0, doubtful: 0, errors: [] }
  for (const mb of RIGA_MAILBOXES) {
    try {
      const r = await sortRigaInbox(mb)
      total.checked += r.checked; total.moved += r.moved; total.doubtful += r.doubtful
      total.errors.push(...r.errors.map(e => `${mb.split('@')[0]}@ · ${e}`))
    } catch (e: any) { total.errors.push(`${mb.split('@')[0]}@ · Riga : ${e?.message || String(e)}`) }
  }
  return total
}

export type { AgentMessage }

// src/lib/mail-agent/settle.ts
//
// CARTES RÉGLÉES DANS LA BOÎTE (Olivier 06/10/2026 : « une fois qu'il a détecté des mails, il
// attend une réponse même si les mails sont traités en direct dans la boîte »).
// À chaque passage, les cartes ouvertes sont revérifiées, quelques dizaines à la fois :
//   - factures fournisseurs et tri : fermées « Fait ailleurs » quand le mail a été déplacé,
//     supprimé ou archivé, quand quelqu'un y a répondu ou l'a transféré, ou quand la pièce est
//     déjà dans l'ERP (même référence, même montant). Un mail seulement lu ne ferme rien ;
//   - rejets de facture (Allianz/AWP, IMA) : jamais fermés parce que le mail a bougé. Seulement
//     sur preuve : note de crédit ou facture refaite dans l'ERP, ou réponse envoyée à
//     l'assistance dans le fil (pas à une adresse de l'ERP) ;
//   - copies de nos factures envoyées par l'ERP (22 h) : ce ne sont pas des factures d'achat,
//     fermées et mises à la corbeille ;
//   - rejets reçus en double : rattachés à la carte la plus ancienne.
// La raison reste sur la carte (journal « décision »).

import { odooRpcCompany } from '@/lib/odoo'
import { messageState, sentInConversation, relocateMessage, moveMessage, listAllFolders } from './graph'

const OPEN_SIMPLE = ['to_decide', 'to_verify', 'waiting']
const OPEN_REJECT = ['to_verify', 'blocked', 'ready']
const OURS = /@(verviersdepannage\.(com|be)|verviers-depannage\.odoo\.com|hoos\.cloud)$/i
const OUR_INVOICE_COPY = /^Verviers D[ée]pannage Facture \(R[ée]f/i
const fr = (iso: string) => new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })

export interface SettleReport { checked: number; closed: number; reasons: Record<string, number>; errors: string[] }

async function close(sb: any, item: any, why: string, status: 'decided' | 'ignored' = 'decided') {
  const now = new Date().toISOString()
  await sb.from('mail_agent_items').update({
    status, applied_at: now, applied_by: 'agent', updated_at: now,
    extracted: { ...(item.extracted || {}), decision: { action: 'fait_ailleurs', by: 'agent', at: now, result: why } },
  }).eq('id', item.id)
}

/** Le mail est-il encore là où la carte l'a vu ? Sinon : déplacé (où ?) ou supprimé. */
async function whereIsIt(item: any, folderNames: Map<string, string>): Promise<{ gone?: string; verb?: number; conversationId?: string | null }> {
  let st = await messageState(item.mailbox, item.message_id)
  let movedId: string | null = null
  if (!st) {
    movedId = item.received_at ? await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject }) : null
    if (!movedId) return { gone: 'mail supprimé ou archivé dans la boîte' }
    st = await messageState(item.mailbox, movedId)
    if (!st) return { gone: 'mail supprimé ou archivé dans la boîte' }
  }
  const now = folderNames.get(st.folderId) || ''
  const was = String(item.folder || '').split('/').pop()!.trim().toLowerCase()
  const nowName = now.split('/').pop()!.trim().toLowerCase()
  const inbox = (n: string) => /^(inbox|boîte de réception)$/.test(n)
  if (/^(éléments supprimés|deleted items)$/.test(nowName)) return { gone: 'mail mis à la corbeille', verb: st.verb, conversationId: st.conversationId }
  if (now && nowName !== was && !(inbox(nowName) && inbox(was))) return { gone: `mail classé dans « ${now} »`, verb: st.verb, conversationId: st.conversationId }
  return { verb: st.verb, conversationId: st.conversationId }
}

async function inErp(ex: any): Promise<string | null> {
  const ref = String(ex?.invoice_number || '').trim()
  if (ref.length < 3) return null
  for (const company of [1, 2, 3]) {
    try {
      const rows: any[] = await odooRpcCompany(company, 'account.move', 'search_read', [[['move_type', 'in', ['in_invoice', 'in_refund', 'in_receipt']], ['ref', 'ilike', ref], ['state', '!=', 'cancel'], ['company_id', '=', company]]], { fields: ['name', 'amount_total', 'partner_id'], limit: 5 })
      const hit = rows.find(r => !ex.total || Math.abs(Number(r.amount_total) - Number(ex.total)) < 0.02)
      if (hit) return `pièce déjà dans l’ERP (${hit.name || 'brouillon'} · ${hit.partner_id?.[1] || ''})`
    } catch { /* société inaccessible : on passe */ }
  }
  return null
}

async function rejectProof(item: any, conversationId: string | null | undefined): Promise<string | null> {
  const num = String(item.extracted?.invoiceNumber || item.odoo_move_name || (String(item.subject || '').match(/20\d\d\/\d\d\/\d{3,4}/) || [])[0] || '')
  if (num) {
    const inv: any[] = await odooRpcCompany(1, 'account.move', 'search_read', [[['name', '=', num], ['move_type', '=', 'out_invoice']]], { fields: ['id', 'payment_state'], limit: 1 })
    if (inv[0]) {
      const nc: any[] = await odooRpcCompany(1, 'account.move', 'search_read', [[['reversed_entry_id', '=', inv[0].id], ['state', '=', 'posted']]], { fields: ['name'], limit: 1 })
      if (nc[0]) return `rejet traité : note de crédit ${nc[0].name}`
      if (inv[0].payment_state === 'paid' || inv[0].payment_state === 'in_payment') return `rejet réglé : facture ${num} payée`
    }
  }
  if (conversationId) {
    const sent = await sentInConversation(item.mailbox, conversationId).catch(() => [])
    const toThem = sent.find(s => s.sentAt >= String(item.received_at || '') && s.to.some(a => !OURS.test(a)))
    if (toThem) return `rejet traité : réponse envoyée à ${toThem.to.find(a => !OURS.test(a))} le ${fr(toThem.sentAt)}`
  }
  return null
}

/** Une passe de vérification. `limit` borne le nombre de cartes relues (appels à la boîte). */
export async function settleOpenCards(sb: any, limit = 60): Promise<SettleReport> {
  const out: SettleReport = { checked: 0, closed: 0, reasons: {}, errors: [] }
  const count = (k: string) => { out.closed++; out.reasons[k] = (out.reasons[k] || 0) + 1 }

  // 1. Copies de nos factures (envoi de 22 h) prises pour des factures d'achat : fermées, mail à la corbeille.
  const { data: copies } = await sb.from('mail_agent_items').select('*').eq('handler', 'fournisseur').in('status', OPEN_SIMPLE).limit(500)
  for (const it of (copies || []).filter((c: any) => OUR_INVOICE_COPY.test(String(c.subject || '').trim()) && /notifications@verviers-depannage\.odoo\.com/i.test(c.from_email || ''))) {
    await moveMessage(it.mailbox, it.message_id, 'deleteditems').catch(() => null)
    await sb.from('mail_agent_items').update({ status: 'ignored', blocked_reason: 'Copie de notre facture envoyée par l’ERP (envoi de 22 h) : pas une facture d’achat — corbeille', updated_at: new Date().toISOString() }).eq('id', it.id)
    count('copie de notre facture')
  }

  // 2. Rejets en double sur une même facture : rattachés à la carte la plus ancienne.
  const { data: rejects } = await sb.from('mail_agent_items').select('id, handler, mailbox, received_at, subject, extracted, status').in('handler', ['awp_rejet', 'ima_rejet']).in('status', OPEN_REJECT).order('received_at').order('id').limit(500)
  const firstBy = new Map<string, any>()
  for (const r of rejects || []) {
    const num = String(r.extracted?.invoiceNumber || (String(r.subject || '').match(/20\d\d\/\d\d\/\d{3,4}/) || [])[0] || '')
    if (!num) continue
    const k = `${r.handler}|${num}`
    const first = firstBy.get(k)
    if (!first) { firstBy.set(k, r); continue }
    await sb.from('mail_agent_items').update({ status: 'ignored', blocked_reason: `Doublon du rejet de la facture ${num} (reçu deux fois) : suivi sur la première carte.`, extracted: { ...(r.extracted || {}), duplicateOf: first.id }, updated_at: new Date().toISOString() }).eq('id', r.id)
    count('rejet reçu en double')
  }

  // 3. Cartes ouvertes, les moins récemment vérifiées d'abord.
  const { data: items } = await sb.from('mail_agent_items').select('*')
    .or(`and(handler.in.(fournisseur,triage),status.in.(${OPEN_SIMPLE.join(',')})),and(handler.in.(awp_rejet,ima_rejet),status.in.(${OPEN_REJECT.join(',')}))`)
    .order('updated_at', { ascending: true }).limit(limit)
  const folderNames = new Map<string, Map<string, string>>()
  for (const it of items || []) {
    out.checked++
    try {
      if (!folderNames.has(it.mailbox)) folderNames.set(it.mailbox, new Map((await listAllFolders(it.mailbox)).map(f => [f.id, f.path.replace(/^\//, '')])))
      const w = await whereIsIt(it, folderNames.get(it.mailbox)!)
      let why: string | null = null
      if (it.handler === 'awp_rejet' || it.handler === 'ima_rejet') {
        why = await rejectProof(it, w.conversationId)   // le déplacement du mail ne suffit jamais
      } else {
        why = w.gone || (w.verb === 102 || w.verb === 103 ? 'quelqu’un a répondu au mail' : w.verb === 104 ? 'mail transféré' : null)
        if (!why && it.handler === 'fournisseur') why = await inErp(it.extracted)
      }
      if (why) { await close(sb, it, `Fait ailleurs : ${why}`); count(why.replace(/ \(.*|« .*/, '').trim()) }
      else await sb.from('mail_agent_items').update({ updated_at: new Date().toISOString() }).eq('id', it.id)   // rotation
    } catch (e: any) { out.errors.push(`${it.subject} : ${e?.message || e}`) }
  }
  return out
}

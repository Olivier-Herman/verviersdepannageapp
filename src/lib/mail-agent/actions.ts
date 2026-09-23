// src/lib/mail-agent/actions.ts
//
// ACTIONS DES CARTES DE DÉCISION (Olivier 23/09/2026, jour 2). Une décision
// humaine sur une carte de triage devient un geste :
//   avoir          → avoir sur la facture citée + mail au demandeur
//   envoyer_doc    → le PDF de la facture citée, envoyé au demandeur
//   repondre_paye  → « déjà payée le … », d'après Odoo
//   rembourser     → confirmation de remboursement (le virement reste humain)
//   brouillon / repondre / contester → réponse rédigée par Claude
//   encoder        → transfert du mail à la boîte d'encodage Odoo de la société
// Mode `mail_agent_mode` : 'draft' = avoir en brouillon + mail en brouillon
// dans administration@ ; 'auto' = avoir comptabilisé + mail envoyé. Tout part
// d'administration@verviersdepannage.com (Olivier 23/09/2026), jamais d'info@.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { odooRpc } from '@/lib/odoo'
import { fetchInvoicePdfFromOdoo } from '@/lib/relances/odoo'
import { sendEmail, type EmailAttachment } from '@/lib/emails'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getMessageText, forwardMessage, findFolderIdByName, moveMessage } from './graph'
import { readAutoFamilies } from './triage'
import { COMPANIES, type CompanyKey } from './handlers/fournisseur'

export const OUT_MAILBOX = 'administration@verviersdepannage.com'
const SIGNATURE = `<p>Bien à vous,<br>Verviers Dépannage SA<br>Lefin 12, 4860 Pepinster · 087/35 18 20 · administration@verviersdepannage.com</p>`
const G = 'https://graph.microsoft.com/v1.0'

export interface ActionResult { ok: boolean; note: string; error?: string; links?: { label: string; url: string }[] }
type Mode = 'draft' | 'auto'
type Ctx = { sb: any; item: any; actor: string; mode: Mode; odooBase: string }

/** Mail sortant : brouillon dans administration@ (draft) ou envoi (auto). */
async function outMail(mode: Mode, to: string, subject: string, html: string, attachments: EmailAttachment[] = [], cc?: string): Promise<string> {
  if (mode === 'auto') { await sendEmail(to, subject, html, undefined, cc, attachments, OUT_MAILBOX); return `mail envoyé à ${to}` }
  const token = await getAppOnlyToken()
  const body: any = { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }], attachments: attachments.map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType, contentBytes: a.contentBytes })) }
  if (cc) body.ccRecipients = [{ emailAddress: { address: cc } }]
  const r = await fetch(`${G}/users/${encodeURIComponent(OUT_MAILBOX)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status !== 201) throw new Error(`brouillon refusé (${r.status}) : ${(await r.text()).slice(0, 160)}`)
  return `brouillon prêt dans administration@ pour ${to}`
}
/**
 * RÉPONDRE dans le fil (Olivier 23/09/2026) : on utilise la fonction Répondre
 * de la boîte sur le mail reçu — même conversation, mail d'origine cité — au
 * lieu d'un mail neuf. Expéditeur forcé à administration@ quand la boîte le
 * permet. draft = le brouillon reste dans la boîte ; auto = envoyé.
 */
async function replyMail(mode: Mode, item: any, html: string, attachments: EmailAttachment[] = [], cc?: string): Promise<string> {
  const token = await getAppOnlyToken()
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const base = `${G}/users/${encodeURIComponent(item.mailbox)}/messages/${item.message_id}`
  const r = await fetch(`${base}/createReply`, { method: 'POST', headers: H, body: JSON.stringify({}) })
  if (r.status !== 201) throw new Error(`Répondre refusé (${r.status}) : ${(await r.text()).slice(0, 160)}`)
  const draft: any = await r.json()
  const quoted = String(draft.body?.content || '')
  const patch: any = { body: { contentType: 'HTML', content: html + quoted } }
  if (cc) patch.ccRecipients = [{ emailAddress: { address: cc } }]
  const p1 = await fetch(`${base.replace(item.message_id, draft.id)}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) })
  if (!p1.ok) throw new Error(`corps de réponse refusé (${p1.status})`)
  // Expéditeur administration@ (Olivier 23/09) — si la boîte refuse, le brouillon reste au nom de la boîte.
  let fromNote = ''
  if (item.mailbox.toLowerCase() !== OUT_MAILBOX) {
    const p2 = await fetch(`${base.replace(item.message_id, draft.id)}`, { method: 'PATCH', headers: H, body: JSON.stringify({ from: { emailAddress: { address: OUT_MAILBOX } } }) })
    fromNote = p2.ok ? '' : ` (expéditeur ${item.mailbox.split('@')[0]}@ : la boîte n'accepte pas l'envoi au nom d'administration@)`
  }
  for (const a of attachments) {
    await fetch(`${base.replace(item.message_id, draft.id)}/attachments`, { method: 'POST', headers: H, body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType, contentBytes: a.contentBytes }) })
  }
  if (mode === 'auto') {
    const s = await fetch(`${base.replace(item.message_id, draft.id)}/send`, { method: 'POST', headers: H })
    if (s.status !== 202) throw new Error(`envoi refusé (${s.status}) : ${(await s.text()).slice(0, 160)}`)
    return `réponse envoyée dans le fil${fromNote}`
  }
  return `réponse en brouillon dans le fil, boîte ${item.mailbox.split('@')[0]}@${fromNote}`
}
const pdfOf = async (invId: number, name: string): Promise<EmailAttachment> => ({ name: `${name.replace(/\//g, '-')}.pdf`, contentType: 'application/pdf', contentBytes: (await fetchInvoicePdfFromOdoo(invId)).toString('base64') })
const odooLink = (base: string, id: number) => base ? `${base}/web#id=${id}&model=account.move&view_type=form` : ''

function pickInvoice(item: any, wanted?: string | null) {
  const list: any[] = (item.extracted?.facts?.invoices || []).filter((i: any) => !i.missing)
  if (wanted) return list.find(i => i.name === wanted) || null
  return list.length === 1 ? list[0] : null
}

let _claude: Anthropic | null = null
const claude = () => (_claude ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))
async function writeReply(item: any, intent: string, extra: string, instruction?: string | null): Promise<{ subject: string; html: string }> {
  const text = (await getMessageText(item.mailbox, item.message_id)).slice(0, 6000)
  const x = item.extracted || {}
  const facts = [...(x.facts?.invoices || []).map((i: any) => i.missing ? `facture ${i.name} : introuvable chez nous` : `facture ${i.name} du ${i.date} : ${i.partner}, ${i.amount_total} € TVAC, ${i.state === 'posted' ? (i.payment_state === 'paid' ? 'payée' : i.payment_state === 'reversed' ? 'annulée par avoir' : 'impayée') : i.state}${i.has_credit_note ? ', avoir existant' : ''}`), ...(x.facts?.fiches || []).map((f: any) => `fiche ${f.number} (${f.plate}) : ${f.type} ${f.source}, ${f.status}${f.invoice ? ', facturée ' + f.invoice : ''}`)].join('\n')
  const guide = instruction && instruction.trim() ? `
CONSIGNE DU BUREAU (prioritaire sur tout le reste, à suivre fidèlement) : ${instruction.trim()}
` : ''
  const r = await claude().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 900, messages: [{ role: 'user', content: `Tu rédiges, pour Verviers Dépannage SA (société belge de dépannage, service administratif), la réponse à un mail reçu. Intention : ${intent}. ${extra}${guide}
Faits vérifiés dans nos systèmes :
${facts || '(aucun)'}
Règles : français courtois et sobre, tutoiement interdit, pas de promesse non couverte par les faits, pas de mention d'outil interne, ne pas inventer de montant ni de date. Termine par le dernier paragraphe utile : PAS de formule de politesse finale ni de signature (elles sont ajoutées après). Réponds STRICTEMENT en JSON : {"subject":"<objet, commençant par RE: si c'est une réponse>","html":"<corps en HTML simple, paragraphes <p>>"}

Mail reçu :
De : ${item.from_email}
Objet : ${item.subject}
${text}` }] })
  const raw = (r.content[0] as any)?.text || ''; const m = raw.match(/\{[\s\S]*\}/)
  const j = m ? JSON.parse(m[0]) : null
  if (!j?.html) throw new Error('réponse non rédigée')
  return { subject: String(j.subject || `RE: ${item.subject}`).slice(0, 200), html: String(j.html) + SIGNATURE }
}

export async function executeDecision(ctx: Ctx, action: string, params: { invoice?: string | null; company?: CompanyKey | null; folder?: string | null; instruction?: string | null } = {}): Promise<ActionResult> {
  const { sb, item, mode, odooBase } = ctx
  const to = String(item.from_email || '')
  const x = item.extracted || {}
  try {
    if (action === 'avoir') {
      const inv = pickInvoice(item, params.invoice)
      if (!inv) return { ok: false, note: '', error: (x.facts?.invoices || []).length > 1 ? 'Plusieurs factures citées : choisis laquelle.' : 'Aucune facture reconnue sur ce mail.' }
      if (inv.has_credit_note) return { ok: false, note: '', error: `La facture ${inv.name} a déjà un avoir.` }
      const full = await odooRpc<any[]>('account.move', 'read', [[inv.id]], { fields: ['journal_id', 'state', 'reversal_move_ids'] })
      if ((full?.[0]?.reversal_move_ids || []).length) return { ok: false, note: '', error: `La facture ${inv.name} a déjà un avoir dans Odoo.` }
      const wiz = await odooRpc<number>('account.move.reversal', 'create', [{ move_ids: [[6, 0, [inv.id]]], date: new Date().toISOString().slice(0, 10), reason: `À la demande de ${to} — ${String(item.subject || '').slice(0, 80)}`, journal_id: full[0].journal_id[0] }])
      await odooRpc('account.move.reversal', 'reverse_moves', [[wiz]])
      const w = await odooRpc<any[]>('account.move.reversal', 'read', [[wiz]], { fields: ['new_move_ids'] })
      const ncId: number = (w?.[0]?.new_move_ids || [])[0]
      if (!ncId) throw new Error('avoir non créé')
      let ncName = `brouillon #${ncId}`
      const atts: EmailAttachment[] = []
      if (mode === 'auto') { await odooRpc('account.move', 'action_post', [[ncId]]); const nc = await odooRpc<any[]>('account.move', 'read', [[ncId]], { fields: ['name'] }); ncName = nc?.[0]?.name || ncName; atts.push(await pdfOf(ncId, ncName)) }
      const html = `<p>Bonjour,</p><p>Suite à votre message, vous trouverez ${mode === 'auto' ? 'ci-joint' : 'ci-après'} la note de crédit <b>${ncName}</b> qui annule notre facture ${inv.name} du ${inv.date} (${inv.amount_total.toLocaleString('fr-BE', { minimumFractionDigits: 2 })} € TVAC).</p>${SIGNATURE}`
      const sent = await replyMail(mode, item, html, atts)
      return { ok: true, note: `Avoir ${ncName} sur ${inv.name} (${mode === 'auto' ? 'comptabilisé' : 'en brouillon, à valider puis joindre au mail'}) · ${sent}`, links: [{ label: `Avoir ${ncName}`, url: odooLink(odooBase, ncId) }] }
    }
    if (action === 'envoyer_doc') {
      const list: any[] = (x.facts?.invoices || []).filter((i: any) => !i.missing)
      const chosen = params.invoice ? list.filter(i => i.name === params.invoice) : list
      if (!chosen.length) return { ok: false, note: '', error: 'Aucune facture reconnue à envoyer.' }
      const atts = await Promise.all(chosen.map(i => pdfOf(i.id, i.name)))
      const html = `<p>Bonjour,</p><p>Comme demandé, vous trouverez ci-joint ${chosen.length > 1 ? 'les documents suivants' : 'le document suivant'} : ${chosen.map(i => `facture ${i.name} du ${i.date}, ${i.amount_total.toLocaleString('fr-BE', { minimumFractionDigits: 2 })} € TVAC`).join(' ; ')}.</p>${SIGNATURE}`
      const sent = await replyMail(mode, item, html, atts)
      return { ok: true, note: `${chosen.map(i => i.name).join(', ')} · ${sent}` }
    }
    if (action === 'repondre_paye') {
      const inv = pickInvoice(item, params.invoice)
      if (!inv) return { ok: false, note: '', error: 'Choisis la facture concernée.' }
      const pays = await odooRpc<any[]>('account.move', 'read', [[inv.id]], { fields: ['payment_state', 'invoice_payments_widget'] }).catch(() => [])
      const paid = inv.payment_state === 'paid' || pays?.[0]?.payment_state === 'paid'
      if (!paid) return { ok: false, note: '', error: `Odoo ne montre pas ${inv.name} comme payée (${inv.payment_state}).` }
      const html = `<p>Bonjour,</p><p>Notre facture ${inv.name} du ${inv.date} (${inv.amount_total.toLocaleString('fr-BE', { minimumFractionDigits: 2 })} € TVAC) apparaît réglée dans nos livres. Si un justificatif vous est utile, nous vous le transmettons volontiers.</p>${SIGNATURE}`
      const sent = await replyMail(mode, item, html)
      return { ok: true, note: `${inv.name} payée · ${sent}` }
    }
    if (action === 'rembourser') {
      const r = await writeReply(item, 'confirmer que le remboursement demandé sera effectué par virement dans les prochains jours, sans donner de date précise', 'Reprendre le montant et le compte bancaire cités dans le mail s\'ils y sont.', params.instruction)
      const sent = await replyMail(mode, item, r.html)
      return { ok: true, note: `Confirmation de remboursement · ${sent} · le virement reste à faire par le bureau` }
    }
    if (action === 'brouillon' || action === 'repondre' || action === 'contester') {
      const intent = action === 'contester' ? 'contester poliment la demande en s\'appuyant uniquement sur les faits vérifiés' : 'répondre à la demande en s\'appuyant sur les faits vérifiés ; si une information manque, dire qu\'elle est en cours de vérification'
      const r = await writeReply(item, intent, '', params.instruction)
      const sent = await replyMail('draft', item, r.html)   // toujours en brouillon : une réponse rédigée se relit
      return { ok: true, note: `Réponse rédigée · ${sent} (à relire avant envoi)` }
    }
    if (action === 'encoder') {
      const co = COMPANIES[params.company || 'vd']
      const fw = await forwardMessage(item.mailbox, item.message_id, co.alias, `Encodage (agent mail VD Soft) — ${co.label}`)
      if (!fw.ok) return { ok: false, note: '', error: fw.error }
      const fid = await findFolderIdByName(item.mailbox, 'Fournisseur Divers'); if (fid) await moveMessage(item.mailbox, item.message_id, fid).catch(() => {})
      return { ok: true, note: `Transféré pour encodage à ${co.alias} (${co.label}), mail classé dans Fournisseur Divers` }
    }
    return { ok: false, note: '', error: `Action inconnue : ${action}` }
  } catch (e: any) {
    return { ok: false, note: '', error: e?.message || String(e) }
  }
}

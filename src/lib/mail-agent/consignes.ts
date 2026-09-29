// src/lib/mail-agent/consignes.ts — consignes en clair pour l'Agent Mail, comme le
// Courrier (Olivier 29/09/2026 : « je n'ai pas de possibilité de dire à l'agent ce
// qu'il faut faire ? »). L'agent traduit la consigne en gestes, les montre (« Ce que
// j'ai compris »), et n'agit qu'après « Faire ça ». Consigne retenue par expéditeur.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { executeDecision, type ActionResult } from './actions'
import { FILE_FOLDERS } from './triage'
import { findOrCreateFolder, moveMessage, relocateMessage } from './graph'
import { sendNotification } from '@/lib/notifications/send'

export type MailStepKind = 'reply_draft' | 'avoir' | 'envoyer_doc' | 'repondre_paye' | 'encoder' | 'classer' | 'ef_frais_justice' | 'nc_refacture' | 'notify' | 'rien'
export interface MailStep { kind: MailStepKind; label: string; params: Record<string, any> }

let client: Anthropic | null = null
const getClient = () => client || (client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

const SYSTEM = `Tu es l'Agent Mail d'un groupe de dépannage belge (sociétés : Verviers Dépannage "vd", Dépannage Riga "riga", DGJ VHU "dgj"). On te donne un mail reçu déjà analysé (résumé, demande, factures et fiches reconnues) et la consigne écrite par l'utilisateur (ou la consigne retenue pour cet expéditeur).
Tu traduis la consigne en gestes concrets, dans l'ordre. Gestes possibles (kind → params) :
- reply_draft { instruction } : préparer un BROUILLON de réponse à l'expéditeur (jamais envoyé), instruction = ce qu'il faut dire.
- avoir { invoice } : créer l'avoir (note de crédit) qui annule la facture citée (nom exact d'une facture fournie).
- envoyer_doc { invoice } : renvoyer au client le PDF d'une facture citée (null = toutes les factures reconnues).
- repondre_paye { invoice } : répondre que la facture citée est payée (seulement si elle l'est).
- encoder { company } : facture fournisseur à encoder : transférer le mail à l'encodage des achats de "vd", "riga" ou "dgj".
- classer { folder } : ranger le mail dans un dossier parmi : ${FILE_FOLDERS.map(f => `"${f}"`).join(', ')}.
- nc_refacture { invoice, client } : créer dans Odoo la note de crédit liée à la facture « invoice » (numéro exact, cité dans la consigne ou le mail) et REFACTURER la même facture au client « client » (nom tel qu'écrit dans la consigne) : nouvelle facture en brouillon.
- ef_frais_justice { mission_id } : saisie dont l'état de frais est parti au Parquet alors qu'il relève des Frais de justice : noter la levée « aux frais de justice » sur la fiche et RENVOYER le même état de frais (même numéro) à l'adresse des Frais de justice. mission_id = id d'une fiche fournie.
- notify { user_id, message } : prévenir une personne par notification.
- rien {} : rien d'autre à faire (retirer la carte).
Règles : la consigne prime ; n'utilise que les factures, fiches et personnes fournies ; « moi » = l'utilisateur qui parle ; les réponses à l'expéditeur restent des brouillons ; "label" = une phrase courte et concrète en français, sans jargon.
Si une partie de la consigne ne correspond à AUCUN geste de la liste, ne l'invente pas : décris-la dans "impossible".
Retourne UNIQUEMENT un JSON strict : { "understood": <1 phrase>, "steps": [ { "kind": …, "label": …, "params": { … } } ], "impossible": <null ou phrase : ce que tu ne sais pas encore faire> }`

export async function planMail(item: any, instruction: string, people: { id: string; name: string; role: string }[], me: { id: string; name: string | null }): Promise<{ understood: string; steps: MailStep[]; impossible: string | null }> {
  const x = item.extracted || {}
  const invoices = (x.facts?.invoices || []).filter((i: any) => !i.missing)
  const ctx = {
    mail: { de: item.from_email, objet: item.subject, boite: item.mailbox, resume: x.summary, demande: x.asked },
    factures: invoices.map((i: any) => ({ name: i.name, client: i.partner, montant: i.amount_total, etat: i.state, paiement: i.payment_state })),
    fiches: (x.facts?.fiches || []).map((f: any) => ({ id: f.id, plaque: f.plate, fiche: f.number, source: f.source, statut: f.status })),
    consigne: instruction, personnes: people, utilisateur_qui_parle: me,
  }
  const resp = await createWithModelFallback(getClient(), ANTHROPIC_MODELS, { max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(ctx) }] })
  const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  let j: any
  try { j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch { throw new Error('L’agent n’a pas su reformuler : précisez la consigne.') }
  const invNames = new Set(invoices.map((i: any) => i.name)), peopleIds = new Set(people.map(p => p.id))
  const ficheIds = new Set((x.facts?.fiches || []).map((f: any) => f.id))
  const steps: MailStep[] = (Array.isArray(j.steps) ? j.steps : []).filter((s: any) => {
    const p = s?.params || {}
    switch (s?.kind) {
      case 'reply_draft': return !!p.instruction
      case 'avoir': case 'repondre_paye': return invNames.has(p.invoice)
      case 'envoyer_doc': return p.invoice == null || invNames.has(p.invoice)
      case 'encoder': return ['vd', 'riga', 'dgj'].includes(p.company)
      case 'classer': return FILE_FOLDERS.includes(p.folder)
      case 'ef_frais_justice': return ficheIds.has(p.mission_id)
      case 'nc_refacture': return !!String(p.invoice || '').trim() && !!String(p.client || '').trim()
      case 'notify': return peopleIds.has(p.user_id) && !!p.message
      case 'rien': return true
      default: return false
    }
  }).map((s: any) => ({ kind: s.kind, label: String(s.label || ''), params: s.params || {} }))
  const impossible = j.impossible ? String(j.impossible) : null
  if (!steps.length && !impossible) steps.push({ kind: 'rien', label: 'Rien d’autre à faire : retirer la carte.', params: {} })
  return { understood: String(j.understood || ''), steps, impossible }
}

/** Exécute les gestes validés (« Faire ça »). Le mail est classé à la fin (dossier
 *  demandé, sinon « Mail auto-géré »), sauf transfert à l'encodage (déjà classé). */
export async function executeMailSteps(ctx: { sb: any; item: any; actor: string; actorId: string | null; mode: 'draft' | 'auto'; odooBase: string }, steps: MailStep[]): Promise<{ results: { kind: string; ok: boolean; note: string }[]; links: { label: string; url: string }[] }> {
  const { sb, item } = ctx
  const results: { kind: string; ok: boolean; note: string }[] = []
  const links: { label: string; url: string }[] = []
  const push = (kind: string, r: ActionResult) => { results.push({ kind, ok: r.ok, note: r.ok ? r.note : (r.error || 'échec') }); for (const l of r.links || []) links.push(l) }
  let folder: string | null = null
  for (const s of steps) {
    const p = s.params || {}
    try {
      switch (s.kind) {
        case 'reply_draft': push(s.kind, await executeDecision(ctx, 'brouillon', { instruction: String(p.instruction).slice(0, 1000) })); break
        case 'avoir': push(s.kind, await executeDecision(ctx, 'avoir', { invoice: p.invoice })); break
        case 'envoyer_doc': push(s.kind, await executeDecision(ctx, 'envoyer_doc', { invoice: p.invoice || null })); break
        case 'repondre_paye': push(s.kind, await executeDecision(ctx, 'repondre_paye', { invoice: p.invoice })); break
        case 'encoder': { const r = await executeDecision(ctx, 'encoder', { company: p.company }); push(s.kind, r); if (r.ok) folder = 'Fournisseur Divers'; break }
        case 'classer': folder = p.folder; results.push({ kind: s.kind, ok: true, note: `À ranger dans « ${p.folder} »` }); break
        case 'nc_refacture': {
          // Note de crédit liée + refacturation au client demandé (même logique que
          // les rejets d'assisteurs : NC comptabilisée, nouvelle facture en brouillon).
          const { findInvoiceByName, creditAndRebill } = await import('./odoo')
          const { odooRpc } = await import('@/lib/odoo')
          const { buildInvoiceMoveUrl } = await import('@/lib/odoo-quote')
          const inv = await findInvoiceByName(String(p.invoice).trim())
          if (!inv) { results.push({ kind: s.kind, ok: false, note: `Facture ${p.invoice} introuvable.` }); break }
          if (inv.state !== 'posted') { results.push({ kind: s.kind, ok: false, note: `La facture ${inv.name} n’est pas validée (${inv.state}).` }); break }
          if ((inv.reversal_move_ids || []).length) { results.push({ kind: s.kind, ok: false, note: `La facture ${inv.name} a déjà une note de crédit.` }); break }
          const q = String(p.client).trim()
          const cands = await odooRpc<any[]>('res.partner', 'search_read', [[['name', 'ilike', q], ['active', '=', true]]], { fields: ['id', 'name', 'vat', 'parent_id'], limit: 8 })
          const exact = (cands || []).filter(c => c.name.trim().toLowerCase() === q.toLowerCase())
          const pick = exact.length === 1 ? exact[0] : (cands || []).filter(c => !c.parent_id).length === 1 ? (cands || []).filter(c => !c.parent_id)[0] : (cands || []).length === 1 ? cands[0] : null
          if (!pick) { results.push({ kind: s.kind, ok: false, note: (cands || []).length ? `Plusieurs clients correspondent à « ${q} » : ${(cands || []).slice(0, 5).map(c => c.name).join(', ')} — précisez.` : `Aucun client « ${q} » dans Odoo.` }); break }
          const r = await creditAndRebill(inv, { id: pick.id, name: pick.name }, { key: 'consigne', label: pick.name, vat: pick.vat || '', zeroVat: false })
          if (r.creditNoteId) links.push({ label: `NC ${r.creditNoteName || r.creditNoteId}`, url: buildInvoiceMoveUrl(r.creditNoteId) })
          if (r.newInvoiceId) links.push({ label: `Facture ${r.newInvoiceName || r.newInvoiceId}`, url: buildInvoiceMoveUrl(r.newInvoiceId) })
          results.push({ kind: s.kind, ok: !!r.creditNoteId && !!r.newInvoiceId,
            note: r.creditNoteId && r.newInvoiceId ? `NC ${r.creditNoteName} liée à ${inv.name}, facture refaite au nom de ${pick.name} (${r.newInvoiceName}, en brouillon à valider).${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}` : `Opération incomplète : ${r.warnings.join(' ') || 'voir Odoo'}` })
          break
        }
        case 'ef_frais_justice': {
          // Saisie : l'état de frais relève des Frais de justice → levée « aux frais de
          // justice » sur la fiche, puis RENVOI du même état de frais (même numéro) :
          // le routage envoie alors à la boîte Frais de justice (resolveRecipientEmail).
          const { data: d } = await sb.from('saisie_dossiers').select('id').eq('mission_id', p.mission_id).maybeSingle()
          if (!d) { results.push({ kind: s.kind, ok: false, note: 'Pas de dossier de saisie pour cette fiche.' }); break }
          const { data: efs } = await sb.from('saisie_etats_frais').select('id, numero').eq('dossier_id', d.id).order('created_at', { ascending: false }).limit(1)
          const ef = efs?.[0]; if (!ef) { results.push({ kind: s.kind, ok: false, note: 'Aucun état de frais sur ce dossier.' }); break }
          const { data: m } = await sb.from('incoming_missions').select('levee_saisie_payer, saisie_motif_code').eq('id', p.mission_id).maybeSingle()
          if (String(m?.saisie_motif_code || '').toUpperCase() !== 'SAISIE_JUDICIAIRE' && m?.levee_saisie_payer !== 'frais_justice') {
            await sb.from('incoming_missions').update({ levee_saisie_payer: 'frais_justice', updated_at: new Date().toISOString() }).eq('id', p.mission_id)
          }
          const { resendEtatFrais } = await import('@/lib/missions/saisie-dossier')
          const r = await resendEtatFrais(sb, d.id, ef.id, ctx.actorId)
          if (r.ok) await sb.from('mission_logs').insert({ mission_id: p.mission_id, actor_id: ctx.actorId, action: 'ef_frais_justice', notes: `État de frais ${r.numero} renvoyé aux Frais de justice (${r.email}) sur consigne via l’Agent Mail (${ctx.actor}).`, metadata: { mail_item_id: item.id } })
          results.push({ kind: s.kind, ok: r.ok, note: r.ok ? `État de frais ${r.numero} renvoyé aux Frais de justice (${r.email}).` : (r.error || 'renvoi impossible') }); break
        }
        case 'notify': {
          const r: any = await sendNotification(p.user_id, 'courrier_task', { title: `Mail de ${item.from_email}`, body: String(p.message).slice(0, 200), action_url: '/mail-agent' })
          results.push({ kind: s.kind, ok: !!r?.ok, note: r?.ok ? 'Personne prévenue.' : 'Notification non partie.' }); break
        }
        case 'rien': results.push({ kind: s.kind, ok: true, note: 'Rien d’autre.' }); break
      }
    } catch (e: any) { results.push({ kind: s.kind, ok: false, note: e?.message || 'échec' }) }
  }
  // Rangement final du mail (identifiant périmé → retrouvé).
  if (!steps.some(s => s.kind === 'encoder' && results.find(r => r.kind === 'encoder')?.ok)) {
    try {
      const target = folder || 'Mail auto-géré'
      const fid = await findOrCreateFolder(item.mailbox, target)
      if (fid) {
        let mv = await moveMessage(item.mailbox, item.message_id, fid)
        if (!mv.ok && /404|ErrorItemNotFound/.test(mv.error || '')) { const again = await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject }); if (again) mv = await moveMessage(item.mailbox, again, fid) }
        if (mv.ok) { await sb.from('mail_agent_items').update({ mail_moved: true, folder: target, ...(mv.newId ? { message_id: mv.newId } : {}) }).eq('id', item.id); results.push({ kind: 'classer', ok: true, note: `Mail rangé dans « ${target} ».` }) }
        else results.push({ kind: 'classer', ok: false, note: `Mail non rangé : ${mv.error}` })
      }
    } catch (e: any) { results.push({ kind: 'classer', ok: false, note: e?.message || 'mail non rangé' }) }
  }
  return { results, links }
}

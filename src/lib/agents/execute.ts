// src/lib/agents/execute.ts
//
// Ce que VD Soft EXÉCUTE pour une proposition d'agent (lot 1, Olivier 05/10/2026).
// Deux temps par type :
//   prepare() — contrôle et normalise la proposition au dépôt (rien n'est écrit
//               dans l'ERP) et dit si l'envoi direct est permis ;
//   execute() — l'action réelle, après validation humaine ou en envoi direct.
// Toujours sur la société de la proposition (odooRpcCompany).

import { odooRpcCompany } from '@/lib/odoo'
import { getBusinessNumber, getBusinessList } from '@/lib/settings/business'
import { findInvoiceByName, creditAndRebill } from '@/lib/mail-agent/odoo'
import { sendEmail, type EmailAttachment } from '@/lib/emails'
import { OUT_MAILBOX, SIGNATURE } from '@/lib/mail-agent/actions'
import type { AgentAccount, ProposalKind } from './core'
import { resolveBankParts, postBankParts } from './bank-match'

export interface Prepared {
  title: string
  amount: number | null
  payload: Record<string, any>
  /** L'envoi direct est-il permis par la règle métier (hors garde-fou de nuit) ? */
  directAllowed: boolean
  directWhy?: string
}

const today = () => new Date().toISOString().slice(0, 10)
const ids = (v: unknown): number[] => (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0)

/** Partenaires des sociétés du groupe (factures intra-groupe : sans limite pour Rémi). */
async function groupPartnerIds(company: number): Promise<number[]> {
  const r: any[] = await odooRpcCompany(company, 'res.company', 'search_read', [[]], { fields: ['partner_id'] }).catch(() => [])
  return (r || []).map(c => c.partner_id?.[0]).filter(Boolean)
}

async function readBill(company: number, id: number) {
  const r: any[] = await odooRpcCompany(company, 'account.move', 'read', [[id]], {
    fields: ['id', 'name', 'ref', 'move_type', 'state', 'payment_state', 'company_id', 'partner_id', 'amount_untaxed', 'amount_total', 'invoice_date', 'peppol_message_uuid'],
  })
  return r?.[0] || null
}

export async function prepare(kind: ProposalKind, agent: AgentAccount, company: number, body: any): Promise<Prepared> {
  const p = body?.contenu || {}

  if (kind === 'facture_achat') {
    const id = Number(p.facture_id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('contenu.facture_id (identifiant de la facture d’achat en brouillon) obligatoire.')
    const b = await readBill(company, id)
    if (!b) throw new Error(`Facture ${id} introuvable dans ${company}.`)
    if (b.company_id?.[0] !== company) throw new Error('Cette facture n’appartient pas à la société indiquée.')
    if (!['in_invoice', 'in_refund'].includes(b.move_type)) throw new Error('Ce n’est pas une facture d’achat.')
    if (b.state !== 'draft') throw new Error(`Facture déjà ${b.state === 'posted' ? 'validée' : 'annulée'}.`)
    if (!b.partner_id) throw new Error('Fournisseur manquant sur le brouillon.')
    if (!b.invoice_date) throw new Error('Date de facture manquante sur le brouillon.')
    // Doublon : même fournisseur, même référence, déjà validée.
    if (b.ref) {
      const dup: any[] = await odooRpcCompany(company, 'account.move', 'search_read', [[['id', '!=', id], ['company_id', '=', company], ['move_type', '=', b.move_type], ['partner_id', '=', b.partner_id[0]], ['ref', '=', b.ref], ['state', '=', 'posted']]], { fields: ['name'], limit: 1 })
      if (dup?.length) throw new Error(`Doublon : ${dup[0].name} porte déjà la référence ${b.ref} pour ce fournisseur.`)
    }
    let directAllowed = false, directWhy: string | undefined
    if (company === 2) {
      const group = await groupPartnerIds(company)
      if (group.includes(b.partner_id[0])) { directAllowed = true; directWhy = 'facture entre sociétés du groupe' }
      else if (b.peppol_message_uuid && b.amount_untaxed <= await getBusinessNumber('agents_seuil_riga_htva')) { directAllowed = true; directWhy = 'Peppol, sous le seuil HTVA' }
    }
    return { title: `${b.partner_id[1]} · ${b.ref || b.name || 'brouillon'}`, amount: b.amount_total, payload: { facture_id: id, fournisseur: b.partner_id[1], reference: b.ref, htva: b.amount_untaxed, peppol: Boolean(b.peppol_message_uuid) }, directAllowed, directWhy }
  }

  if (kind === 'lot_paiement') {
    if (company !== 1) throw new Error('Lot de paiement : seulement Verviers Dépannage pour l’instant (paiements fournisseurs depuis ING).')
    const factureIds = ids(p.facture_ids)
    if (!factureIds.length) throw new Error('contenu.facture_ids (factures d’achat à payer) obligatoire.')
    if (factureIds.length > 100) throw new Error('100 factures au plus par lot.')
    const bills: any[] = await odooRpcCompany(company, 'account.move', 'read', [factureIds], { fields: ['id', 'name', 'ref', 'move_type', 'state', 'payment_state', 'company_id', 'partner_id', 'amount_residual', 'invoice_date_due'] })
    const bad = factureIds.filter(i => {
      const b = bills.find(x => x.id === i)
      return !b || b.company_id?.[0] !== company || b.move_type !== 'in_invoice' || b.state !== 'posted' || !['not_paid', 'partial'].includes(b.payment_state)
    })
    if (bad.length) throw new Error(`Factures non payables (introuvables, pas validées, déjà payées ou d’une autre société) : ${bad.join(', ')}.`)
    const total = Math.round(bills.reduce((s, b) => s + (b.amount_residual || 0), 0) * 100) / 100
    return { title: `${bills.length} facture${bills.length > 1 ? 's' : ''} · ING`, amount: total, payload: { facture_ids: factureIds, factures: bills.map(b => ({ id: b.id, nom: b.name, ref: b.ref, fournisseur: b.partner_id?.[1], reste: b.amount_residual, echeance: b.invoice_date_due })) }, directAllowed: false }
  }

  if (kind === 'note_credit') {
    if (company !== 1) throw new Error('Note de crédit : seulement Verviers Dépannage pour l’instant.')
    const name = String(p.facture || '').trim()
    if (!name) throw new Error('contenu.facture (numéro de la facture client) obligatoire.')
    const inv = await findInvoiceByName(name)
    if (!inv) throw new Error(`Facture ${name} introuvable.`)
    if (inv.state !== 'posted') throw new Error(`Facture ${name} pas encore validée : rien à créditer.`)
    if (inv.reversal_move_ids?.length) throw new Error(`Facture ${name} déjà créditée (note de crédit existante).`)
    const motif = String(p.motif || '').trim().slice(0, 300)
    if (!motif) throw new Error('contenu.motif obligatoire (il figure sur la note de crédit).')
    const partnerId = p.refacturer_partner_id != null ? Number(p.refacturer_partner_id) : null
    let target: { id: number; name: string } | null = null
    if (partnerId) {
      const r: any[] = await odooRpcCompany(company, 'res.partner', 'read', [[partnerId]], { fields: ['id', 'name'] })
      if (!r?.[0]) throw new Error(`Client ${partnerId} introuvable.`)
      target = { id: r[0].id, name: r[0].name }
    }
    return {
      title: `${inv.name}${target ? ` → refacturée à ${target.name}` : ' (note de crédit seule)'}`, amount: inv.amount_total ?? null,
      payload: { facture: inv.name, facture_id: inv.id, motif, refacturer: target },
      directAllowed: body?.certain === true, directWhy: body?.certain === true ? 'déclarée certaine par l’agent' : undefined,
    }
  }

  if (kind === 'rapprochement_bouton') {
    // Exactement le bouton « Rapprocher » de Finance › Réconciliation (lot 2, fait seul).
    if (company !== 1) throw new Error('Rapprochement au bouton : Verviers Dépannage seulement (societe=1).')
    const source = String(p.source || '')
    if (!['paynovate', 'sumup', 'assureur'].includes(source)) throw new Error('contenu.source : paynovate, sumup ou assureur.')
    const id = Number(p.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('contenu.id obligatoire (versement Paynovate / SumUp, ou ligne de banque du virement de l’assureur).')
    return { title: `${source === 'assureur' ? 'Assureur, ligne de banque' : source === 'sumup' ? 'SumUp' : 'Paynovate'} ${id}`, amount: null, payload: { source, id }, directAllowed: true, directWhy: 'rapprochement au bouton (Olivier 05/10/2026)' }
  }

  if (kind === 'rapprochement_banque') {
    const lineId = Number(p.ligne_id)
    if (!Number.isInteger(lineId) || lineId <= 0) throw new Error('contenu.ligne_id obligatoire (ligne de banque non rapprochée).')
    const { line, resume } = await resolveBankParts(company, lineId, p.parts)
    return {
      title: `${line.journal_id?.[1] || 'Banque'} ${line.date} · ${Number(line.amount).toFixed(2)} € · ${String(line.payment_ref || '').replace(/\s+/g, ' ').slice(0, 60)}`,
      amount: Number(line.amount), payload: { ligne_id: lineId, parts: p.parts, ventilation: resume },
      directAllowed: true, directWhy: 'rapprochement de banque (permis quand Olivier l’active)',
    }
  }

  if (kind === 'question_olivier') {
    // Facture d'achat au nom privé d'une personne (Olivier 05/10/2026) : ni
    // encodée ni écartée d'office, Olivier tranche. Les infos sont lues dans l'ERP.
    if (String(p.sujet || '') !== 'facture_nom_prive') throw new Error('contenu.sujet : seul « facture_nom_prive » est prévu pour l’instant.')
    const id = Number(p.facture_id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('contenu.facture_id obligatoire.')
    const destinataire = String(p.destinataire || '').trim().slice(0, 300)
    if (!destinataire) throw new Error('contenu.destinataire obligatoire (nom et adresse lus sur la pièce).')
    const [b]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[id]], { fields: ['id', 'name', 'ref', 'state', 'move_type', 'company_id', 'partner_id', 'invoice_date', 'amount_untaxed', 'amount_total', 'invoice_source_email'] })
    if (!b || b.company_id?.[0] !== company || !['in_invoice', 'in_refund'].includes(b.move_type)) throw new Error('Facture d’achat introuvable dans cette société.')
    const lines: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', id], ['display_type', '=', 'product']]], { fields: ['name', 'price_subtotal'] })
    const mail: any[] = await odooRpcCompany(company, 'mail.message', 'search_read', [[['model', '=', 'account.move'], ['res_id', '=', id], ['message_type', '=', 'email']]], { fields: ['email_from', 'subject', 'date'], limit: 1, order: 'id asc' })
    const fournisseur = b.partner_id?.[1] || String(p.fournisseur || '').trim().slice(0, 120) || 'fournisseur non reconnu'
    return {
      title: `Facture au nom privé · ${fournisseur} · ${b.ref || b.name || id}`, amount: b.amount_total,
      payload: {
        sujet: 'facture_nom_prive', facture_id: id, fournisseur, reference: b.ref, date: b.invoice_date, destinataire,
        htva: b.amount_untaxed, tvac: b.amount_total, lignes: lines.map(l => `${String(l.name || '').replace(/\s+/g, ' ').slice(0, 120)} · ${l.price_subtotal} €`).slice(0, 10),
        mail: mail[0] ? { de: mail[0].email_from, objet: mail[0].subject, date: mail[0].date } : null,
      },
      directAllowed: false,
    }
  }

  // envoi_comptable
  const to = String(p.a || '').trim().toLowerCase()
  const allowed = (await getBusinessList('agents_comptable_destinataires').catch(() => [] as string[])).map(x => x.toLowerCase())
  if (!allowed.includes(to)) throw new Error(allowed.length ? `Destinataire non autorisé. Adresses du comptable : ${allowed.join(', ')}.` : 'Aucune adresse du comptable n’est réglée (Réglages métier) : envoi impossible.')
  const objet = String(p.objet || '').trim().slice(0, 200), message = String(p.message || '').trim().slice(0, 4000)
  if (!objet || !message) throw new Error('contenu.objet et contenu.message obligatoires.')
  const pieces = ids(p.facture_ids)
  if (!pieces.length) throw new Error('contenu.facture_ids (pièces retrouvées à joindre) obligatoire.')
  const moves: any[] = await odooRpcCompany(company, 'account.move', 'read', [pieces], { fields: ['id', 'name', 'company_id'] })
  if (moves.length !== pieces.length || moves.some(m => m.company_id?.[0] !== company)) throw new Error('Pièces introuvables ou d’une autre société.')
  return { title: `${objet} · ${moves.length} pièce${moves.length > 1 ? 's' : ''}`, amount: null, payload: { a: to, objet, message, facture_ids: pieces, pieces: moves.map(m => m.name) }, directAllowed: true, directWhy: 'pièces retrouvées, Mobi en copie' }
}

/** PDF principal d'une pièce de l'ERP. */
async function movePdf(company: number, id: number): Promise<EmailAttachment | null> {
  const a: any[] = await odooRpcCompany(company, 'ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', id], ['mimetype', '=', 'application/pdf']]], { fields: ['name', 'datas'], limit: 1, order: 'id asc' })
  return a?.[0]?.datas ? { name: a[0].name || `piece-${id}.pdf`, contentType: 'application/pdf', contentBytes: a[0].datas } : null
}

export async function execute(kind: ProposalKind, company: number, payload: any): Promise<Record<string, any>> {
  if (kind === 'question_olivier') throw new Error('Une question ne s’exécute pas : on y répond.')
  if (kind === 'rapprochement_bouton') {
    const { reconcileSource } = await import('./lot2')
    return { note: await reconcileSource(payload.source, payload.id, null) }
  }
  if (kind === 'rapprochement_banque') {
    const { parts, resume } = await resolveBankParts(company, payload.ligne_id, payload.parts)   // relu : l'ERP a pu bouger depuis le dépôt
    await postBankParts(company, payload.ligne_id, parts)
    return { note: `Ligne ${payload.ligne_id} rapprochée : ${resume.join(' ; ')}`.slice(0, 900) }
  }
  if (kind === 'facture_achat') {
    const b = await readBill(company, payload.facture_id)
    if (!b || b.state !== 'draft') throw new Error('La facture n’est plus en brouillon (validée ou supprimée entre-temps).')
    await odooRpcCompany(company, 'account.move', 'action_post', [[b.id]])
    const after = await readBill(company, b.id)
    return { note: `Facture validée : ${after?.name || b.id}`, facture: after?.name }
  }

  if (kind === 'lot_paiement') {
    const factureIds: number[] = payload.facture_ids
    const [journal, method] = await Promise.all([getBusinessNumber('odoo_journal_paiement_fournisseurs'), getBusinessNumber('odoo_methode_virement_sepa')])
    const still: any[] = await odooRpcCompany(company, 'account.move', 'read', [factureIds], { fields: ['id', 'state', 'payment_state'] })
    const paid = still.filter(b => b.state !== 'posted' || !['not_paid', 'partial'].includes(b.payment_state)).map(b => b.id)
    if (paid.length) throw new Error(`Déjà payées ou modifiées depuis la proposition : ${paid.join(', ')}. Refusez et demandez un nouveau lot.`)
    const ctx = { active_model: 'account.move', active_ids: factureIds }
    const wiz = await odooRpcCompany<number>(company, 'account.payment.register', 'create', [{ journal_id: journal, payment_method_line_id: method, payment_date: today(), group_payment: true }], { context: ctx })
    await odooRpcCompany(company, 'account.payment.register', 'action_create_payments', [[wiz]], { context: ctx })
    const pays: any[] = await odooRpcCompany(company, 'account.payment', 'search_read', [[['reconciled_bill_ids', 'in', factureIds], ['batch_payment_id', '=', false], ['journal_id', '=', journal]]], { fields: ['id'] })
    if (!pays.length) throw new Error('Paiements créés introuvables : vérifiez dans l’ERP avant de recommencer.')
    await odooRpcCompany(company, 'account.payment', 'create_batch_payment', [pays.map(p => p.id)])
    const batch: any[] = await odooRpcCompany(company, 'account.payment', 'read', [[pays[0].id]], { fields: ['batch_payment_id'] })
    return { note: `Lot créé : ${batch?.[0]?.batch_payment_id?.[1] || '?'} (${pays.length} paiement${pays.length > 1 ? 's' : ''}) — fichier à charger dans ING`, lot: batch?.[0]?.batch_payment_id?.[1], lot_id: batch?.[0]?.batch_payment_id?.[0], paiements: pays.map(p => p.id) }
  }

  if (kind === 'note_credit') {
    const inv = await findInvoiceByName(payload.facture)
    if (!inv) throw new Error(`Facture ${payload.facture} introuvable.`)
    if (payload.refacturer) {
      const r = await creditAndRebill(inv, payload.refacturer, { key: 'agent', label: payload.refacturer.name, vat: '', zeroVat: false } as any)
      if (r.newInvoiceId) await odooRpcCompany(company, 'account.move', 'action_post', [[r.newInvoiceId]])
      const fresh: any[] = r.newInvoiceId ? await odooRpcCompany(company, 'account.move', 'read', [[r.newInvoiceId]], { fields: ['name'] }) : []
      return { note: `Note de crédit ${r.creditNoteName || '?'} · nouvelle facture ${fresh?.[0]?.name || r.newInvoiceName || '?'} validée`, note_credit: r.creditNoteName, facture: fresh?.[0]?.name || null, avertissements: r.warnings }
    }
    const wiz = await odooRpcCompany<number>(company, 'account.move.reversal', 'create', [{ move_ids: [[6, 0, [inv.id]]], date: today(), reason: payload.motif, journal_id: inv.journal_id ? inv.journal_id[0] : false }])
    await odooRpcCompany(company, 'account.move.reversal', 'reverse_moves', [[wiz]])
    const fresh: any[] = await odooRpcCompany(company, 'account.move', 'read', [[inv.id]], { fields: ['reversal_move_ids'] })
    const ncId = fresh?.[0]?.reversal_move_ids?.slice(-1)[0]
    if (ncId) {
      const nc: any[] = await odooRpcCompany(company, 'account.move', 'read', [[ncId]], { fields: ['name', 'state'] })
      if (nc?.[0]?.state === 'draft') await odooRpcCompany(company, 'account.move', 'action_post', [[ncId]])
      const n2: any[] = await odooRpcCompany(company, 'account.move', 'read', [[ncId]], { fields: ['name'] })
      return { note: `Note de crédit ${n2?.[0]?.name || ncId} validée`, note_credit: n2?.[0]?.name }
    }
    throw new Error('Note de crédit introuvable après création : vérifiez dans l’ERP.')
  }

  // envoi_comptable — depuis la boîte de Mobi, jamais administration@ (Olivier 05/10/2026),
  // signé « Benoît — Assistant IA de Mobi » (seule exception de dévoilement : le cabinet le sait).
  const atts: EmailAttachment[] = []
  for (const id of payload.facture_ids as number[]) { const a = await movePdf(company, id); if (a) atts.push(a) }
  if (!atts.length) throw new Error('Aucun PDF trouvé pour ces pièces dans l’ERP.')
  const html = `<p>${String(payload.message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p><p>Benoît — Assistant IA de Mobi</p>`
  const { writeToComptable, COMPTABLE_AGENT } = await import('./comptable-mailbox')
  await writeToComptable({ kind: 'agent', agent: { name: COMPTABLE_AGENT } as any }, { to: [payload.a], subject: payload.objet, html, attachments: atts }, true)
  return { note: `Envoyé à ${payload.a} depuis la boîte de Mobi · ${atts.length} pièce${atts.length > 1 ? 's' : ''}`, pieces: atts.map(a => a.name) }
}

export type { AgentAccount }

// src/lib/agents/execute.ts
//
// Ce que VD Soft EXÉCUTE pour une proposition d'agent (lot 1, Olivier 05/10/2026).
// Deux temps par type :
//   prepare() — contrôle et normalise la proposition au dépôt (rien n'est écrit
//               dans l'ERP) et dit si l'envoi direct est permis ;
//   execute() — l'action réelle, après validation humaine ou en envoi direct.
// Toujours sur la société de la proposition (odooRpcCompany).

import { alignCreditNotes } from '@/lib/facturation/credit-note-align'
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
    // Garde-fou anti-doublon (Olivier 20/10/2026 : CFDP B1RGF1 et hôtel VER-IN encodés deux fois) : une autre pièce
    // du même fournisseur, au même montant, datée à 60 jours près (validée ou brouillon) = doublon possible → jamais
    // validée seule, elle part chez Olivier avec la pièce en face.
    const d0 = new Date(b.invoice_date); const lo = new Date(d0.getTime() - 60 * 864e5).toISOString().slice(0, 10), hi = new Date(d0.getTime() + 60 * 864e5).toISOString().slice(0, 10)
    const twins: any[] = await odooRpcCompany(company, 'account.move', 'search_read', [[['id', '!=', id], ['company_id', '=', company], ['move_type', '=', b.move_type], ['partner_id', '=', b.partner_id[0]], ['state', 'in', ['posted', 'draft']], ['amount_total', '>=', b.amount_total - 0.01], ['amount_total', '<=', b.amount_total + 0.01], ['invoice_date', '>=', lo], ['invoice_date', '<=', hi]]], { fields: ['name', 'ref', 'state'], limit: 3 })
    const doublonPossible = twins.length ? twins.map(t => `${t.name || 'brouillon'}${t.ref ? ` (${t.ref})` : ''}`).join(', ') : null
    let directAllowed = false, directWhy: string | undefined
    // Riga (Olivier 06/10/2026) : « s'il est certain il le valide » — Peppol, PDF, mail ou scan,
    // sans limite de montant. Au moindre doute (certain absent ou faux) : validation par Olivier.
    if (company === 2 && body?.certain === true) {
      directAllowed = true
      directWhy = b.peppol_message_uuid ? 'Peppol, lecture certaine' : 'PDF / mail / scan, lecture certaine'
    }
    // Verviers Dépannage (Olivier 13/10/2026) : « si c'est du Peppol, ça doit se valider de toute
    // façon ; il doit juste mettre un stop s'il hésite pour une avance de fonds ». Peppol = validée,
    // sauf `stop: true` (doute avance de fonds) ; une pièce hors Peppol reste en validation.
    if (company === 1 && b.peppol_message_uuid && body?.stop !== true) {
      directAllowed = true
      directWhy = 'Peppol (règle du 13/10/2026)'
    }
    // Hors Peppol (Olivier 20/10/2026, autonomie validée : 28 validations sur 28 sans correction) : seul si
    // l'agent est certain de sa lecture et ne doute pas d'une avance de fonds.
    if (company === 1 && !b.peppol_message_uuid && body?.certain === true && body?.stop !== true) {
      directAllowed = true
      directWhy = 'hors Peppol, lecture certaine (autonomie du 20/10/2026)'
    }
    if (doublonPossible) { directAllowed = false; directWhy = undefined }
    return { title: `${b.partner_id[1]} · ${b.ref || b.name || 'brouillon'}${doublonPossible ? ` · ⚠️ doublon possible : ${doublonPossible}` : ''}`, amount: b.amount_total, payload: { facture_id: id, fournisseur: b.partner_id[1], reference: b.ref, htva: b.amount_untaxed, peppol: Boolean(b.peppol_message_uuid), ...(doublonPossible ? { doublon_possible: doublonPossible } : {}) }, directAllowed, directWhy }
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
    // Olivier 16/10/2026 : « si c'est la bonne facture avec le bon montant, pas besoin d'attendre ma validation ».
    // Seul cas exécuté sans validation : UNE facture, montant identique au centime à la ligne de banque ET au reste
    // dû, et sa référence (ou son numéro) retrouvée dans la communication de la banque. Tout le reste attend Olivier.
    const exact = await exactBankMatch(company, line, p.parts)
    return {
      title: `${line.journal_id?.[1] || 'Banque'} ${line.date} · ${Number(line.amount).toFixed(2)} € · ${String(line.payment_ref || '').replace(/\s+/g, ' ').slice(0, 60)}`,
      amount: Number(line.amount), payload: { ligne_id: lineId, parts: p.parts, ventilation: resume },
      // Riga (Olivier 20/10/2026, autonomie validée : 12 validations sur 12) : Rémi rapproche seul quand il est certain
      // (règles du 20/10 : frais bancaires, DGJ, 580000, NN). Une ligne qui demande une pièce reste chez Olivier.
      directAllowed: exact.ok || (company === 2 && body?.certain === true),
      directWhy: exact.ok ? `bonne facture, montant exact (${exact.why})` : company === 2 && body?.certain === true ? 'Riga, rapprochement certain (autonomie du 20/10/2026)' : undefined,
    }
  }

  if (kind === 'declaration_tva') {
    // Mail « … - DECLARATION TVA MM-AAAA » du cabinet comptable (Olivier 23/10/2026) : relu dans info@ par VD Soft.
    const { lireDeclaration, factureExistante } = await import('./tva-declaration')
    const { decl: d } = await lireDeclaration(String(p.message_id || ''))
    if (d.societe !== company) throw new Error(`Ce mail concerne la société ${d.societe}, pas ${company}.`)
    if (d.societe === 3) throw new Error('DGJ : hors périmètre tant que ses relevés ne sont pas dans l’ERP (Olivier 23/10/2026).')
    const deja = await factureExistante(d)
    if (deja) throw new Error(`Déjà encodée : ${deja}.`)
    return { title: `${d.ref} · ${d.montant.toFixed(2)} € · échéance ${d.echeance.split('-').reverse().join('/')}`, amount: d.montant,
      payload: { message_id: d.message_id, sujet: d.sujet, periode: d.periode, montant: d.montant, echeance: d.echeance, communication: d.communication, ref: d.ref }, directAllowed: false }
  }

  if (kind === 'plaque_achat') {
    // Le véhicule du parc est retrouvé par VD Soft à partir de la plaque lue sur la pièce (Olivier 05/10/2026 : fait seul).
    const id = Number(p.facture_id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('contenu.facture_id obligatoire.')
    const b = await readBill(company, id)
    if (!b || b.company_id?.[0] !== company || !['in_invoice', 'in_refund'].includes(b.move_type)) throw new Error('Facture d’achat introuvable dans cette société.')
    if (b.state === 'cancel') throw new Error('Facture annulée.')
    const { vehicleForPlate, normPlate } = await import('./lot2')
    const plaque = normPlate(String(p.plaque || ''))
    if (plaque.length < 4) throw new Error('contenu.plaque obligatoire (telle que lue sur la pièce).')
    const v = await vehicleForPlate(company, plaque)
    const [cur]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[id]], { fields: ['x_studio_plaque_1'] })
    if (cur?.x_studio_plaque_1 && (!v || cur.x_studio_plaque_1[0] !== v.id)) throw new Error(`Déjà reliée à un autre véhicule (${cur.x_studio_plaque_1[1]}) : rien n’est changé.`)
    if (v && cur?.x_studio_plaque_1?.[0] === v.id) throw new Error('Ce véhicule est déjà relié à cette facture.')
    // Plaque introuvable dans le parc : on ne relie rien d'office, Olivier tranche (règle du 05/10/2026).
    if (!v) return { title: `${b.name || b.ref || id} · plaque ${plaque} introuvable dans le parc : à toi`, amount: b.amount_total, payload: { facture_id: id, facture: b.name || b.ref, plaque, vehicule_id: null, vehicule: null, introuvable: true }, directAllowed: false }
    return { title: `${b.name || b.ref || id} → ${v.name}`, amount: b.amount_total, payload: { facture_id: id, facture: b.name || b.ref, plaque, vehicule_id: v.id, vehicule: v.name }, directAllowed: true, directWhy: 'véhicule retrouvé par la plaque' }
  }

  if (kind === 'annulation_doublon') {
    // Même facture reçue par mail ET par Peppol : on garde Peppol, on annule le brouillon du mail (Olivier 05/10/2026 : automatique).
    const draftId = Number(p.brouillon_id), keepId = Number(p.garde_id)
    if (!Number.isInteger(draftId) || !Number.isInteger(keepId) || draftId <= 0 || keepId <= 0 || draftId === keepId) throw new Error('contenu.brouillon_id et contenu.garde_id obligatoires et différents.')
    const [d, k] = await Promise.all([readBill(company, draftId), readBill(company, keepId)])
    if (!d || !k || d.company_id?.[0] !== company || k.company_id?.[0] !== company) throw new Error('Pièces introuvables dans cette société.')
    if (![d, k].every(x => ['in_invoice', 'in_refund'].includes(x.move_type)) || d.move_type !== k.move_type) throw new Error('Deux factures d’achat du même type attendues.')
    if (d.state !== 'draft') throw new Error('Le doublon à annuler doit être un brouillon.')
    if (k.state === 'cancel') throw new Error('La pièce à garder est annulée.')
    if (d.peppol_message_uuid) throw new Error('Le brouillon à annuler est arrivé par Peppol : c’est lui qu’on garde.')
    if (!k.peppol_message_uuid) throw new Error('La pièce à garder n’est pas arrivée par Peppol.')
    if (d.partner_id?.[0] && k.partner_id?.[0] && d.partner_id[0] !== k.partner_id[0]) throw new Error('Fournisseurs différents : ce n’est pas un doublon.')
    if (Math.abs(Number(d.amount_total) - Number(k.amount_total)) > 0.01) throw new Error(`Montants différents (${d.amount_total} € / ${k.amount_total} €) : ce n’est pas un doublon.`)
    const norm = (s: any) => String(s || '').replace(/[^0-9a-z]/gi, '').toLowerCase()
    if (d.ref && k.ref && norm(d.ref) !== norm(k.ref)) throw new Error(`Références différentes (${d.ref} / ${k.ref}) : ce n’est pas un doublon.`)
    return { title: `${k.partner_id?.[1] || ''} · ${k.ref || k.name} : brouillon ${draftId} annulé, ${k.name || keepId} gardé`, amount: k.amount_total, payload: { brouillon_id: draftId, garde_id: keepId, garde: k.name || k.ref, reference: k.ref }, directAllowed: true, directWhy: 'doublon mail + Peppol (même fournisseur, même montant)' }
  }

  if (kind === 'ticket_achat') {
    // Ticket glissé par Olivier dans les achats (brouillon) : encodé en « Ticket » (pas de TVA
    // récupérable sans facture), au vrai nom du commerçant, puis validé. Fait seul (05/10/2026).
    const id = Number(p.facture_id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('contenu.facture_id obligatoire (brouillon du ticket).')
    const b = await readBill(company, id)
    if (!b || b.company_id?.[0] !== company || !['in_invoice', 'in_receipt'].includes(b.move_type)) throw new Error('Brouillon d’achat introuvable dans cette société.')
    if (b.state !== 'draft') throw new Error('Ce n’est plus un brouillon.')
    if (b.peppol_message_uuid) throw new Error('Arrivé par Peppol : c’est une facture, pas un ticket.')
    const fournisseur = String(p.fournisseur || '').trim().slice(0, 120)
    if (fournisseur.length < 2) throw new Error('contenu.fournisseur obligatoire (nom du commerçant lu sur le ticket).')
    const date = String(p.date || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new Error('contenu.date obligatoire (AAAA-MM-JJ, pas dans le futur).')
    const montant = Math.round(Number(p.montant) * 100) / 100
    if (!(montant > 0)) throw new Error('contenu.montant obligatoire (total payé, TVAC).')
    const lines: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', id], ['display_type', '=', 'product']]], { fields: ['id'] })
    if (!lines.length) throw new Error('Le brouillon n’a aucune ligne.')
    return { title: `${fournisseur} · ${date} · ${montant.toFixed(2)} €`, amount: montant, payload: { facture_id: id, fournisseur, date, montant, reference: String(p.reference || '').trim().slice(0, 60) || null }, directAllowed: true, directWhy: 'ticket de caisse (Olivier 05/10/2026)' }
  }

  if (kind === 'refacturation_avance') {
    // Circuit Lallemand / ANWB (05/10/2026) : plaque recopiée et achat validé d'abord, puis le bouton
    // « Refacturer l'avance de fonds », puis l'assistance qui a commandé la mission + son n° de dossier.
    if (company !== 1) throw new Error('Refacturation d’avance : Verviers Dépannage seulement (societe=1).')
    const id = Number(p.achat_id), client = Number(p.client_id), dossier = String(p.dossier || '').trim().slice(0, 60)
    if (!Number.isInteger(id) || id <= 0) throw new Error('contenu.achat_id obligatoire (facture d’achat validée).')
    if (!Number.isInteger(client) || client <= 0) throw new Error('contenu.client_id obligatoire (l’assistance qui a commandé la mission, jamais le propriétaire).')
    if (!dossier) throw new Error('contenu.dossier obligatoire (numéro de dossier de l’assistance).')
    const b = await readBill(company, id)
    if (!b || b.company_id?.[0] !== company || b.move_type !== 'in_invoice') throw new Error('Facture d’achat introuvable.')
    if (b.state !== 'posted') throw new Error('L’achat doit d’abord être validé.')
    const [x]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[id]], { fields: ['x_studio_plaque_1'] })
    if (!x?.x_studio_plaque_1) throw new Error('Plaque absente sur l’achat : la relier d’abord (plaque_achat).')
    const deja: any[] = await odooRpcCompany(company, 'account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['invoice_origin', '=', b.name], ['state', '!=', 'cancel']]], { fields: ['name'], limit: 1 })
    if (deja.length) throw new Error(`Déjà refacturée (${deja[0].name || 'brouillon'}).`)
    const [c]: any[] = await odooRpcCompany(company, 'res.partner', 'read', [[client]], { fields: ['name', 'is_company', 'active'] })
    if (!c?.active) throw new Error('Client introuvable.')
    return { title: `${b.name} (${b.partner_id?.[1] || ''}) → ${c.name} · dossier ${dossier}`, amount: b.amount_untaxed, payload: { achat_id: id, achat: b.name, garage: b.partner_id?.[1] || null, plaque: x.x_studio_plaque_1[1], client_id: client, client: c.name, dossier, htva: b.amount_untaxed }, directAllowed: true, directWhy: 'refacturation d’avance (quand Olivier l’activera)' }
  }

  if (kind === 'question_olivier') {
    // Facture d'achat au nom privé d'une personne (Olivier 05/10/2026) : ni
    // encodée ni écartée d'office, Olivier tranche. Les infos sont lues dans l'ERP.
    // Question libre (Victor, coordinateur des trois sociétés — Olivier 07/10/2026).
    if (String(p.sujet || '') === 'libre') {
      const question = String(p.question || '').trim().slice(0, 2000), contexte = String(p.contexte || '').trim().slice(0, 4000)
      if (!question) throw new Error('contenu.question obligatoire.')
      // Réponses proposées par l'agent (2 à 4, courtes) : boutons sur l'écran et sur Telegram (Olivier 08/10/2026).
      const choix = (Array.isArray(p.choix) ? p.choix : []).map((c: any) => String(c || '').trim()).filter(Boolean).slice(0, 4)
      if (choix.length === 1) throw new Error('contenu.choix : 2 à 4 réponses courtes, ou aucune.')
      if (choix.some((c: string) => c.length > 60)) throw new Error('contenu.choix : chaque réponse fait au plus 60 caractères.')
      return { title: question.slice(0, 160), amount: Number.isFinite(Number(p.montant)) ? Number(p.montant) : null, payload: { sujet: 'libre', question, contexte, lien: String(p.lien || '').slice(0, 500) || null, choix: choix.map((label: string, i: number) => ({ key: `c${i + 1}`, label })) }, directAllowed: false }
    }
    if (String(p.sujet || '') !== 'facture_nom_prive') throw new Error('contenu.sujet : « facture_nom_prive » ou « libre ».')
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

  if (kind === 'od_inter_societes') {
    // Une société a payé une dépense de l'autre (carte ou compte) : pas de refacturation, une OD
    // explicative de chaque côté (Olivier 07/10/2026). Comptes à fixer par Olivier : la validation
    // ne passe encore rien dans l'ERP, elle sert de feu vert pour l'encodage.
    const payeuse = Number(p.societe_payeuse), charge = Number(p.societe_charge)
    if (![1, 2, 3].includes(payeuse) || ![1, 2, 3].includes(charge) || payeuse === charge) throw new Error('contenu.societe_payeuse et contenu.societe_charge : deux sociétés différentes parmi 1, 2, 3.')
    if (!agent.companies.includes(payeuse) || !agent.companies.includes(charge)) throw new Error('Les deux sociétés doivent être dans vos droits.')
    const montant = Number(p.montant)
    if (!(montant > 0)) throw new Error('contenu.montant obligatoire (positif).')
    const libelle = String(p.libelle || '').trim().slice(0, 300)
    if (!libelle) throw new Error('contenu.libelle obligatoire.')
    const date = String(p.date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('contenu.date (AAAA-MM-JJ) obligatoire.')
    return { title: `OD inter-sociétés · ${libelle} · ${montant.toFixed(2)} €`, amount: montant, payload: { societe_payeuse: payeuse, societe_charge: charge, date, montant, libelle, reference_paiement: String(p.reference_paiement || '').slice(0, 200) || null, piece: String(p.piece || '').slice(0, 300) || null }, directAllowed: false }
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

/** Rapprochement « évident » : une facture, montant exact, référence lue dans la communication (16/10/2026). */
async function exactBankMatch(company: number, line: any, parts: any[]): Promise<{ ok: boolean; why: string }> {
  if (!Array.isArray(parts) || parts.length !== 1 || !parts[0]?.facture_id || parts[0].montant != null && Math.abs(Math.abs(Number(parts[0].montant)) - Math.abs(Number(line.amount))) > 0.005) return { ok: false, why: '' }
  const [m]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[Number(parts[0].facture_id)]], { fields: ['name', 'ref', 'payment_reference', 'amount_residual'] })
  if (!m || Math.abs(Math.abs(Number(m.amount_residual)) - Math.abs(Number(line.amount))) > 0.005) return { ok: false, why: '' }
  const norm = (x: any) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const comm = norm(`${line.payment_ref || ''} ${line.narration || ''}`)
  const keys = [m.ref, m.payment_reference, m.name].map(norm).filter(k => k.length >= 5)
  const hit = keys.find(k => comm.includes(k))
  return hit ? { ok: true, why: `${m.name}, référence ${hit} dans la communication` } : { ok: false, why: '' }
}

/** Vente brouillon d'une refacturation d'avance (bouton de l'ERP, client = l'assistance, réf = son dossier,
 *  HTVA du fournisseur, TVA adaptée au client). Préparée dès le dépôt de la proposition pour qu'Olivier la
 *  voie dans les brouillons avant de valider (Olivier 21/10/2026) ; validée et envoyée à l'exécution. */
export async function preparerBrouillonAvance(company: number, payload: any): Promise<{ sid: number; notes: string[] }> {
  const actionId = await getBusinessNumber('odoo_action_refacturer_avance')
  const ctx = { context: { active_model: 'account.move', active_ids: [payload.achat_id], active_id: payload.achat_id } }
  await odooRpcCompany(company, 'ir.actions.server', 'run', [[actionId]], ctx)
  const sale: any[] = await odooRpcCompany(company, 'account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['invoice_origin', '=', payload.achat], ['state', '=', 'draft']]], { fields: ['id'], limit: 2 })
  if (sale.length !== 1) throw new Error('Le bouton « Refacturer l’avance de fonds » n’a pas créé de vente brouillon : à voir dans l’ERP.')
  const sid = sale[0].id
  await odooRpcCompany(company, 'account.move', 'write', [[sid], { partner_id: payload.client_id, ref: payload.dossier }])
  // Olivier 19/10/2026 (Hens) : on refacture le HTVA du fournisseur, jamais la TVA étrangère non récupérable, encodée
  // sur l'achat comme une ligne à part « TVA étrangère … » (achat en intra 0 % au total payé).
  const achatLignes: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', payload.achat_id], ['display_type', '=', 'product']]], { fields: ['name', 'price_subtotal'] })
  const htvaFournisseur = Math.round(achatLignes.filter(l => !/^tva étrangère/i.test(String(l.name || '').trim())).reduce((t, l) => t + Number(l.price_subtotal || 0), 0) * 100) / 100
  const venteLignes: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', sid], ['display_type', '=', 'product']]], { fields: ['id', 'price_unit'] })
  if (venteLignes.length === 1 && htvaFournisseur > 0 && Math.abs(venteLignes[0].price_unit - htvaFournisseur) > 0.005) {
    await odooRpcCompany(company, 'account.move', 'write', [[sid], { invoice_line_ids: [[1, venteLignes[0].id, { price_unit: htvaFournisseur }]] }])
  }
  const { remapTaxes } = await import('./lot2')
  const notes = await remapTaxes(company, sid)
  return { sid, notes }
}

/** Refus ou renvoi d'une refacturation : le brouillon préparé au dépôt est annulé (jamais une vente validée). */
export async function annulerBrouillonAvance(company: number, payload: any): Promise<void> {
  const id = Number(payload?.brouillon_id)
  if (!id) return
  const [d]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[id]], { fields: ['state', 'move_type'] }).catch(() => [])
  if (d?.move_type === 'out_invoice' && d.state === 'draft') await odooRpcCompany(company, 'account.move', 'button_cancel', [[id]])
}

export async function execute(kind: ProposalKind, company: number, payload: any): Promise<Record<string, any>> {
  if (kind === 'question_olivier') throw new Error('Une question ne s’exécute pas : on y répond.')
  if (kind === 'od_inter_societes') return { note: 'Feu vert donné : les deux OD explicatives sont à passer dans l’ERP (comptes à confirmer par Mobi).', manuel: true, ...payload }
  if (kind === 'rapprochement_bouton') {
    const { reconcileSource } = await import('./lot2')
    return { note: await reconcileSource(payload.source, payload.id, null) }
  }
  if (kind === 'declaration_tva') {
    const { encoderDeclaration } = await import('./tva-declaration')
    const r = await encoderDeclaration(String(payload.message_id))
    return { note: `Facture ${r.facture} créée et validée (${r.montant.toFixed(2)} €), le mail joint en PDF.`, facture: r.facture }
  }
  if (kind === 'plaque_achat') {
    // Relue au moment d'exécuter : un véhicule a pu être créé entre-temps.
    const { vehicleForPlate } = await import('./lot2')
    const v = payload.vehicule_id ? { id: payload.vehicule_id, name: payload.vehicule } : await vehicleForPlate(company, payload.plaque)
    if (!v) throw new Error(`Toujours aucun véhicule avec la plaque ${payload.plaque} dans le parc : créez-le, puis validez à nouveau.`)
    const [cur]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[payload.facture_id]], { fields: ['x_studio_plaque_1'] })
    if (cur?.x_studio_plaque_1 && cur.x_studio_plaque_1[0] !== v.id) throw new Error('Un autre véhicule a été relié entre-temps : rien n’est changé.')
    await odooRpcCompany(company, 'account.move', 'write', [[payload.facture_id], { x_studio_plaque_1: v.id }])
    return { note: `${payload.facture} reliée à ${v.name}` }
  }
  if (kind === 'ticket_achat') {
    const b = await readBill(company, payload.facture_id)
    if (!b || b.state !== 'draft') throw new Error('Le ticket n’est plus en brouillon.')
    const { ensureSupplier } = await import('./lot2')
    const sup = await ensureSupplier(company, payload.fournisseur)
    const lines: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', b.id], ['display_type', '=', 'product']]], { fields: ['id'] })
    await odooRpcCompany(company, 'account.move', 'write', [[b.id], {
      move_type: 'in_receipt', partner_id: sup.id, invoice_date: payload.date, ...(payload.reference ? { ref: payload.reference } : {}),
      invoice_line_ids: lines.map(l => [1, l.id, { tax_ids: [[5, 0, 0]] }]),
    }])
    let [after]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[b.id]], { fields: ['amount_total', 'move_type'] })
    if (Math.abs(Number(after.amount_total) - payload.montant) > 0.005) {
      if (lines.length !== 1) throw new Error(`Total ${after.amount_total} € ≠ ${payload.montant} € et plusieurs lignes : à revoir à la main (rien n’est validé).`)
      await odooRpcCompany(company, 'account.move', 'write', [[b.id], { invoice_line_ids: [[1, lines[0].id, { quantity: 1, price_unit: payload.montant }]] }])
      ;[after] = await odooRpcCompany(company, 'account.move', 'read', [[b.id]], { fields: ['amount_total', 'move_type'] })
      if (Math.abs(Number(after.amount_total) - payload.montant) > 0.005) throw new Error(`Total ${after.amount_total} € au lieu de ${payload.montant} € : rien n’est validé.`)
    }
    if (after.move_type !== 'in_receipt') throw new Error('Le type « Ticket » n’a pas pris : rien n’est validé.')
    await odooRpcCompany(company, 'account.move', 'action_post', [[b.id]])
    const fresh = await readBill(company, b.id)
    return { note: `Ticket ${fresh?.name || b.id} : ${payload.fournisseur}${sup.created ? ' (fiche créée)' : ''}, ${payload.montant.toFixed(2)} €, ${payload.date}. À rapprocher de sa ligne de banque.`, ticket: fresh?.name }
  }
  if (kind === 'refacturation_avance') {
    // Brouillon préparé au dépôt (Olivier 21/10/2026) : on le reprend s'il est toujours là.
    let sid = 0, notes: string[] = [], dejaValidee = false
    if (payload.brouillon_id) {
      const [d]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[Number(payload.brouillon_id)]], { fields: ['state', 'move_type'] }).catch(() => [])
      if (d?.move_type === 'out_invoice' && d.state !== 'cancel') { sid = Number(payload.brouillon_id); dejaValidee = d.state === 'posted' }
    }
    if (!sid) ({ sid, notes } = await preparerBrouillonAvance(company, payload))
    if (!dejaValidee) await odooRpcCompany(company, 'account.move', 'action_post', [[sid]])
    const [v]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[sid]], { fields: ['name', 'amount_total'] })
    // Olivier 16/10/2026 : une avance de fonds part depuis l'ERP, « par e-mail » ET « par Peppol » cochés, avec le
    // justificatif dans le mail (Peppol seul ne le transmet pas) — la trace reste dans l'historique de la facture.
    let envoi = 'Envoi au client : depuis l’ERP (société sans envoi automatique).'
    if (company === 1) {
      const { sendAvanceDepuisErp } = await import('@/lib/facturation/avance-mail')
      const r = await sendAvanceDepuisErp(company, sid).catch((e: any) => ({ ok: false, note: String(e?.message || e) }))
      envoi = r.ok ? r.note : `PAS envoyée : ${r.note}`
    }
    return { note: `Vente ${v.name} validée pour ${payload.client} (dossier ${payload.dossier}), ${Number(v.amount_total).toFixed(2)} € TVAC, justificatif joint. ${envoi}`, facture: v.name, avertissements: notes.length ? [`TVA adaptée au client : ${notes.join(' ; ')}`] : [] }
  }
  if (kind === 'annulation_doublon') {
    const d = await readBill(company, payload.brouillon_id)
    if (!d || d.state !== 'draft') throw new Error('Le brouillon n’est plus en brouillon (validé ou supprimé entre-temps).')
    await odooRpcCompany(company, 'account.move', 'button_cancel', [[d.id]])
    return { note: `Brouillon ${d.id} annulé ; on garde ${payload.garde}` }
  }
  if (kind === 'rapprochement_banque') {
    const { parts, resume } = await resolveBankParts(company, payload.ligne_id, payload.parts)   // relu : l'ERP a pu bouger depuis le dépôt
    await postBankParts(company, payload.ligne_id, parts)
    return { note: `Ligne ${payload.ligne_id} rapprochée : ${resume.join(' ; ')}`.slice(0, 900) }
  }
  if (kind === 'facture_achat') {
    const b = await readBill(company, payload.facture_id)
    if (!b || b.state !== 'draft') throw new Error('La facture n’est plus en brouillon (validée ou supprimée entre-temps).')
    // AS 24 / Viapass (Olivier 19/10/2026) : la facture Viapass (prélèvement kilométrique) de la Société wallonne de
    // financement est prélevée par AS 24 Belgium → encodée sur AS 24 - Belgium ; toute facture AS 24 est marquée payée
    // par domiciliation pour ne jamais apparaître dans les factures à payer.
    const as24 = company === 1 ? (await getBusinessList('odoo_partners_as24').catch(() => [] as string[])).map(Number).filter(Boolean) : []
    const swf = /wallonne de financement/i.test(String(b.partner_id?.[1] || ''))
    let domicilie = as24.includes(b.partner_id?.[0])
    if (swf && as24.length) {
      await odooRpcCompany(company, 'account.move', 'write', [[b.id], { partner_id: as24[0] }])
      const chk = await readBill(company, b.id)
      if (Math.abs(Number(chk?.amount_total) - Number(b.amount_total)) > 0.005) {
        await odooRpcCompany(company, 'account.move', 'write', [[b.id], { partner_id: b.partner_id[0] }])
        throw new Error('Facture Viapass : le montant change en passant sur AS 24 - Belgium, laissée en brouillon pour Mobi.')
      }
      domicilie = true
    }
    await odooRpcCompany(company, 'account.move', 'action_post', [[b.id]])
    let paiement = ''
    if (domicilie) {
      const [journal, method] = await Promise.all([getBusinessNumber('odoo_journal_paiement_fournisseurs'), getBusinessNumber('odoo_methode_domiciliation')])
      const ctx = { context: { active_model: 'account.move', active_ids: [b.id], active_id: b.id } }
      const wiz = await odooRpcCompany<number>(company, 'account.payment.register', 'create', [{ journal_id: journal, payment_method_line_id: method, payment_date: b.invoice_date || today(), communication: `${b.ref || ''} — domiciliation AS 24`.trim() }], ctx)
      await odooRpcCompany(company, 'account.payment.register', 'action_create_payments', [[wiz]], ctx)
      paiement = ` — ${swf ? 'Viapass passée sur AS 24 - Belgium, ' : ''}payée par domiciliation`
    }
    const after = await readBill(company, b.id)
    return { note: `Facture validée : ${after?.name || b.id}${paiement}`, facture: after?.name }
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
    const pays: any[] = await odooRpcCompany(company, 'account.payment', 'search_read', [[['reconciled_bill_ids', 'in', factureIds], ['batch_payment_id', '=', false], ['journal_id', '=', journal], ['state', '!=', 'canceled']]], { fields: ['id'] })
    if (!pays.length) throw new Error('Paiements créés introuvables : vérifiez dans l’ERP avant de recommencer.')
    // `create_batch_payment` refuse l'appel par l'API sur l'ERP 19 (constaté le 16/10/2026) : le lot s'écrit directement.
    const [ml]: any[] = await odooRpcCompany(company, 'account.payment.method.line', 'read', [[method]], { fields: ['payment_method_id'] })
    await odooRpcCompany(company, 'account.batch.payment', 'create', [{ batch_type: 'outbound', journal_id: journal, payment_method_id: ml.payment_method_id[0], payment_ids: [[6, 0, pays.map(p => p.id)]] }])
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
      await alignCreditNotes(company, inv.id, [ncId])   // même référence et même véhicule que la facture (07/10/2026)
      // Envoyée au client dans le même passage (Peppol s'il y est inscrit, sinon mail) — 07/10/2026.
      let sentNote = ''
      if (company === 1) { const { postAndSendPeppol } = await import('@/lib/mail-agent/odoo'); const s = await postAndSendPeppol(ncId).catch((e: any) => ({ sent: false, note: String(e?.message || e) })); sentNote = s.sent ? ' et envoyée' : ` — pas envoyée : ${s.note}` }
      const n2: any[] = await odooRpcCompany(company, 'account.move', 'read', [[ncId]], { fields: ['name'] })
      return { note: `Note de crédit ${n2?.[0]?.name || ncId} validée${sentNote}`, note_credit: n2?.[0]?.name }
    }
    throw new Error('Note de crédit introuvable après création : vérifiez dans l’ERP.')
  }

  // envoi_comptable — depuis la boîte de Mobi, jamais administration@ (Olivier 05/10/2026),
  // signé « Victor — Assistant IA de Mobi » (seule exception de dévoilement : le cabinet le sait ; Victor remplace Benoît le 07/10/2026).
  const atts: EmailAttachment[] = []
  for (const id of payload.facture_ids as number[]) { const a = await movePdf(company, id); if (a) atts.push(a) }
  if (!atts.length) throw new Error('Aucun PDF trouvé pour ces pièces dans l’ERP.')
  const html = `<p>${String(payload.message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p><p>Victor — Assistant IA de Mobi</p>`
  const { writeToComptable, COMPTABLE_AGENT } = await import('./comptable-mailbox')
  await writeToComptable({ kind: 'agent', agent: { name: COMPTABLE_AGENT } as any }, { to: [payload.a], subject: payload.objet, html, attachments: atts }, true)
  return { note: `Envoyé à ${payload.a} depuis la boîte de Mobi · ${atts.length} pièce${atts.length > 1 ? 's' : ''}`, pieces: atts.map(a => a.name) }
}

export type { AgentAccount }

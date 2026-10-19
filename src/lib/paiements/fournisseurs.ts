// src/lib/paiements/fournisseurs.ts — paiements fournisseurs (Olivier 16/10/2026).
//
// Circuit, VD et Riga bien séparés :
//   1. Olivier trie les factures fournisseur à payer et les AJOUTE à la liste d'attente ;
//   2. dès qu'Olivier ajoute à la liste d'attente, Momo est prévenu et choisit dans la liste d'attente ce qui part dans le lot ;
//      ce qu'il ne prend pas RESTE en attente et revient seul la fois suivante ;
//   3. lot créé → Olivier prévenu : c'est lui qui génère le fichier XML et l'encode à la banque.
// Un lot dont le XML est généré est FERMÉ : plus rien n'y entre, le paiement suivant ouvre un nouveau lot.
// Rien ne sort de la banque ici : les paiements et le lot restent dans l'ERP jusqu'au chargement du XML.
import { createAdminClient } from '@/lib/supabase'
import { odooRpcCompany, ODOO_COMPANIES } from '@/lib/odoo'
import { belgianHolidayDays } from '@/lib/prestations/belgian-holidays'

export const SOCIETES = [
  { key: 'vd',   id: ODOO_COMPANIES.vd,   label: 'Verviers Dépannage' },
  { key: 'riga', id: ODOO_COMPANIES.riga, label: 'Dépannage Riga' },
] as const

export type Facture = {
  move_id: number; move_name: string; partner_id: number; partner_name: string; ref: string | null
  invoice_date: string | null; due_date: string | null; amount: number; communication: string | null
  iban: string | null          // compte du fournisseur autorisé aux paiements sortants ; null = à compléter
  compte_id: number | null     // id de ce compte dans l'ERP (celui de la facture en priorité)
  // Compte connu mais pas encore confirmé pour les virements (l'ERP refuse alors de payer) : Olivier le confirme.
  ibanAConfirmer: { id: number; acc: string } | null
  // Proposition affichée à l'écran (Olivier 19/10/2026 : « tout me proposer dans l'affichage et je sélectionne »).
  propose?: boolean
  carte?: boolean              // se paie par carte de crédit : jamais dans un lot de virements
  groupe?: boolean             // facture d'une société du groupe : affichée en fin de liste
  remarques?: string[]
}
export type EnAttente = Facture & { id: string; ajoute_le: string }

export function societe(id: number) {
  const s = SOCIETES.find(x => x.id === id)
  if (!s) throw new Error('Société inconnue')
  return s
}

/** Journal et méthode SEPA : ceux du dernier lot SEPA sortant de la société (Riga = ING …7040). */
async function journalSepa(C: number) {
  const [last]: any[] = await odooRpcCompany(C, 'account.batch.payment', 'search_read', [[['batch_type', '=', 'outbound'], ['payment_method_id.code', '=', 'sepa_ct']]], { fields: ['journal_id'], order: 'id desc', limit: 1 })
  if (!last) throw new Error('Aucun lot de virements précédent : impossible de savoir depuis quel compte payer')
  const journal = last.journal_id[0] as number
  const [method]: any[] = await odooRpcCompany(C, 'account.payment.method.line', 'search_read', [[['journal_id', '=', journal], ['code', '=', 'sepa_ct'], ['payment_type', '=', 'outbound']]], { fields: ['id', 'payment_method_id'] })
  if (!method) throw new Error('Méthode « virement SEPA » introuvable sur le compte de paiement')
  return { journal, compte: String(last.journal_id[1] || ''), methodLine: method.id as number, method: method.payment_method_id[0] as number }
}

/** Lot ouvert = lot SEPA sortant en brouillon dont le fichier XML n'a pas encore été généré.
 *  (La date de génération est remplie dès la création du lot : seul le nom du fichier fait foi.) */
async function lotOuvert(C: number, journal: number) {
  const [b]: any[] = await odooRpcCompany(C, 'account.batch.payment', 'search_read', [[['batch_type', '=', 'outbound'], ['journal_id', '=', journal], ['state', '=', 'draft'], ['export_filename', '=', false]]], { fields: ['id', 'name', 'amount'], order: 'id desc', limit: 1 })
  return b || null
}

/** Fournisseurs payés par domiciliation : jamais dans un lot de virements. */
async function fournisseursDomicilies(C: number): Promise<Set<number>> {
  const rows: any[] = await odooRpcCompany(C, 'account.payment', 'search_read', [[['payment_type', '=', 'outbound'], '|', ['payment_method_line_id.name', 'ilike', 'domicil'], ['memo', 'ilike', 'domicil']]], { fields: ['partner_id'], limit: 5000 })
  return new Set(rows.map(r => r.partner_id?.[0]).filter(Boolean))
}

type Compte = { id: number; acc: string; ok: boolean }
async function ibans(C: number, partnerIds: number[]): Promise<Map<number, Compte[]>> {
  const m = new Map<number, Compte[]>()
  if (!partnerIds.length) return m
  const rows: any[] = await odooRpcCompany(C, 'res.partner.bank', 'search_read', [[['partner_id', 'in', partnerIds]]], { fields: ['id', 'acc_number', 'partner_id', 'allow_out_payment'] })
  for (const r of rows) { const k = r.partner_id[0]; m.set(k, [...(m.get(k) || []), { id: r.id, acc: r.acc_number, ok: !!r.allow_out_payment }]) }
  return m
}
const confirmes = (l: Compte[] | undefined) => (l || []).filter(c => c.ok)

const FIELDS = ['id', 'name', 'partner_id', 'partner_bank_id', 'ref', 'invoice_date', 'invoice_date_due', 'amount_residual', 'payment_reference', 'payment_state', 'state', 'move_type']

function toFacture(b: any, bank: Map<number, Compte[]>): Facture {
  const all = bank.get(b.partner_id?.[0]) || []
  const banks = confirmes(all)
  // Le compte indiqué sur la facture passe en premier (Olivier 19/10/2026), s'il appartient bien au fournisseur ;
  // sinon, le seul compte confirmé de sa fiche.
  const surFacture = all.find(c => c.id === b.partner_bank_id?.[0])
  const choisi = surFacture ? (surFacture.ok ? surFacture : null) : (banks.length === 1 ? banks[0] : null)
  const aConfirmer = surFacture ? (surFacture.ok ? null : surFacture) : (!banks.length && all.length === 1 ? all[0] : null)
  return {
    move_id: b.id, move_name: b.name, partner_id: b.partner_id?.[0], partner_name: b.partner_id?.[1] || '?', ref: b.ref || null,
    invoice_date: b.invoice_date || null, due_date: b.invoice_date_due || null, amount: Math.round(b.amount_residual * 100) / 100,
    communication: b.payment_reference || null, iban: choisi?.acc || null, compte_id: choisi?.id || null,
    ibanAConfirmer: aConfirmer ? { id: aConfirmer.id, acc: aConfirmer.acc } : null,
  }
}

/** Factures fournisseur à payer, pas encore dans la liste d'attente (vue de tri d'Olivier). */
export async function aTrier(C: number): Promise<Facture[]> {
  const sb = createAdminClient()
  const [bills, dom, { data: q }] = await Promise.all([
    odooRpcCompany<any[]>(C, 'account.move', 'search_read', [[['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]]], { fields: FIELDS, order: 'invoice_date_due asc, id asc', limit: 1000 }),
    fournisseursDomicilies(C),
    sb.from('paiements_attente').select('move_id').eq('company_id', C).eq('statut', 'attente'),
  ])
  const enAttente = new Set((q || []).map(r => r.move_id))
  // Salaires (pièces PAIE/) : jamais dans les paiements fournisseurs (Olivier 19/10/2026).
  // Fournisseurs payés automatiquement (banques, Police Fédérale) : jamais au tri (Olivier 19/10/2026).
  const { getBusinessList } = await import('@/lib/settings/business')
  const exclus = new Set((await getBusinessList('paiements_exclus_partner_ids').catch(() => [] as string[])).map(Number))
  // Fournisseurs payés par carte de crédit (Peters, Olivier 19/10/2026) : affichés, jamais dans un lot de virements.
  const carte = new Set((await getBusinessList('paiements_carte_partner_ids').catch(() => [] as string[])).map(Number))
  // Factures précises à ne plus afficher (déjà soldées chez la comptable, Olivier 19/10/2026) : la facture seule, pas le fournisseur.
  const masquees = new Set((await getBusinessList('paiements_masques_move_ids').catch(() => [] as string[])).map(Number))
  const keep = bills.filter(b => !dom.has(b.partner_id?.[0]) && !exclus.has(b.partner_id?.[0]) && !masquees.has(b.id) && !enAttente.has(b.id) && !/^PAIE\//.test(b.name || ''))
  const bank = await ibans(C, [...new Set(keep.map(b => b.partner_id?.[0]).filter(Boolean))])
  // Sociétés du groupe (VD, Riga, DGJ) : leurs factures se règlent à part, jamais dans un lot de virements.
  const societes: any[] = await odooRpcCompany(C, 'res.company', 'search_read', [[]], { fields: ['partner_id'] }).catch(() => [])
  const groupe = new Set(societes.map(x => x.partner_id?.[0]).filter(Boolean))
  const horizon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  // Fournisseurs externes d'abord, factures entre sociétés du groupe en fin de liste (Olivier 19/10/2026) ;
  // l'ordre par échéance est conservé dans chaque bloc (tri stable).
  return keep.map(b => {
    const f = toFacture(b, bank)
    const r: string[] = []
    const intra = groupe.has(f.partner_id), avant2026 = !!f.invoice_date && f.invoice_date < '2026-01-01'
    if (intra) r.push('Société du groupe : se règle à part')
    if (carte.has(f.partner_id)) { r.push('À payer par carte de crédit, pas par virement'); f.carte = true }
    if (avant2026) r.push('Facture d’avant 2026 : vérifier qu’elle n’a pas déjà été payée à l’époque')
    f.remarques = r
    f.groupe = intra
    f.propose = !intra && !avant2026 && !f.carte && !!f.iban && !!f.due_date && f.due_date <= horizon
    return f
  }).sort((a, b) => Number(!!a.groupe) - Number(!!b.groupe))
}

/** Liste d'attente, relue dans l'ERP : une facture payée entre-temps (autrement) en sort d'elle-même. */
export async function listeAttente(C: number): Promise<EnAttente[]> {
  const sb = createAdminClient()
  const { data: rows, error } = await sb.from('paiements_attente').select('*').eq('company_id', C).eq('statut', 'attente').order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  if (!rows?.length) return []
  const bills: any[] = await odooRpcCompany(C, 'account.move', 'read', [rows.map(r => r.move_id)], { fields: FIELDS })
  const byId = new Map(bills.map(b => [b.id, b]))
  const gone = rows.filter(r => { const b = byId.get(r.move_id); return !b || b.state !== 'posted' || !['not_paid', 'partial'].includes(b.payment_state) })
  if (gone.length) await sb.from('paiements_attente').update({ statut: 'retire', retire_le: new Date().toISOString() }).in('id', gone.map(r => r.id))
  const live = rows.filter(r => !gone.includes(r))
  const bank = await ibans(C, [...new Set(live.map(r => byId.get(r.move_id)?.partner_id?.[0]).filter(Boolean))])
  // Comme au tri : fournisseurs externes d'abord, sociétés du groupe en fin de liste (Olivier 19/10/2026).
  const societes: any[] = await odooRpcCompany(C, 'res.company', 'search_read', [[]], { fields: ['partner_id'] }).catch(() => [])
  const groupe = new Set(societes.map(x => x.partner_id?.[0]).filter(Boolean))
  return live.map(r => { const f = toFacture(byId.get(r.move_id), bank); return { ...f, groupe: groupe.has(f.partner_id), id: r.id, ajoute_le: r.ajoute_le } })
    .sort((a, b) => Number(!!a.groupe) - Number(!!b.groupe))
}

export async function ajouter(C: number, moveIds: number[], userId: string | null): Promise<number> {
  const dispo = (await aTrier(C)).filter(f => moveIds.includes(f.move_id) && !f.carte)
  if (!dispo.length) return 0
  const { error } = await createAdminClient().from('paiements_attente').insert(dispo.map(f => ({
    company_id: C, move_id: f.move_id, move_name: f.move_name, partner_id: f.partner_id, partner_name: f.partner_name, ref: f.ref,
    invoice_date: f.invoice_date, due_date: f.due_date, amount: f.amount, communication: f.communication, ajoute_par: userId,
  })))
  if (error) throw new Error(error.message)
  return dispo.length
}

export async function retirer(C: number, ids: string[], userId: string | null): Promise<void> {
  const { error } = await createAdminClient().from('paiements_attente').update({ statut: 'retire', retire_par: userId, retire_le: new Date().toISOString() })
    .eq('company_id', C).eq('statut', 'attente').in('id', ids)
  if (error) throw new Error(error.message)
}

/**
 * Momo a coché : un paiement par fournisseur (ses factures regroupées, sur son IBAN), rangé dans le
 * lot ouvert de la société, ou dans un nouveau lot. Le reste de la liste d'attente n'est pas touché.
 */
export async function creerLot(C: number, ids: string[], userId: string | null) {
  const sb = createAdminClient()
  const choisies = (await listeAttente(C)).filter(f => ids.includes(f.id))
  if (!choisies.length) throw new Error('Aucune facture choisie n’est encore à payer')
  const sansIban = choisies.filter(f => !f.iban)
  if (sansIban.length) throw new Error(`IBAN du fournisseur à compléter : ${sansIban.map(f => f.partner_name).join(', ')}`)
  const { journal, methodLine, method } = await journalSepa(C)

  // Un paiement par fournisseur et par compte (deux factures sur deux comptes différents = deux virements).
  const parFournisseur = new Map<string, EnAttente[]>()
  for (const f of choisies) { const k = `${f.partner_id}:${f.compte_id}`; parFournisseur.set(k, [...(parFournisseur.get(k) || []), f]) }

  const today = new Date().toISOString().slice(0, 10)
  const crees: { id: number; name: string; amount: number; factures: EnAttente[] }[] = []
  for (const factures of parFournisseur.values()) {
    const moveIds = factures.map(f => f.move_id)
    // Communication : celle de la facture (structurée si le fournisseur en donne une), sinon sa référence.
    const communication = factures.length === 1
      ? (factures[0].communication || factures[0].ref || factures[0].move_name)
      : factures.map(f => f.ref || f.move_name).join(' ').slice(0, 140)
    const ctx = { active_model: 'account.move', active_ids: moveIds }
    const wiz = await odooRpcCompany<number>(C, 'account.payment.register', 'create', [{ journal_id: journal, payment_method_line_id: methodLine, payment_date: today, group_payment: true, communication, partner_bank_id: factures[0].compte_id }], { context: ctx })
    await odooRpcCompany(C, 'account.payment.register', 'action_create_payments', [[wiz]], { context: ctx })
    const pays: any[] = await odooRpcCompany(C, 'account.payment', 'search_read', [[['reconciled_bill_ids', 'in', moveIds], ['batch_payment_id', '=', false], ['journal_id', '=', journal], ['state', '!=', 'canceled']]], { fields: ['id', 'name', 'amount'] })
    for (const p of pays) crees.push({ id: p.id, name: p.name, amount: p.amount, factures })
  }
  if (!crees.length) throw new Error('Paiements créés introuvables : vérifier dans l’ERP avant de recommencer')

  // `create_batch_payment` refuse l'appel par l'API sur l'ERP 19 : le lot s'écrit directement.
  const ouvert = await lotOuvert(C, journal)
  if (ouvert) await odooRpcCompany(C, 'account.batch.payment', 'write', [[ouvert.id], { payment_ids: crees.map(p => [4, p.id]) }])
  else await odooRpcCompany(C, 'account.batch.payment', 'create', [{ batch_type: 'outbound', journal_id: journal, payment_method_id: method, payment_ids: [[6, 0, crees.map(p => p.id)]] }])
  const lot = await lotOuvert(C, journal)

  const now = new Date().toISOString()
  for (const p of crees) {
    await sb.from('paiements_attente').update({ statut: 'pris', pris_par: userId, pris_le: now, lot: lot?.name || null, paiement: p.name })
      .eq('company_id', C).eq('statut', 'attente').in('id', p.factures.map(f => f.id))
  }
  const total = Math.round(crees.reduce((s, p) => s + p.amount, 0) * 100) / 100
  return { lot: lot?.name || '?', lotTotal: lot ? Math.abs(lot.amount) : total, ajoute: !!ouvert, paiements: crees.length, factures: choisies.length, total }
}

/** Olivier confirme le compte bancaire d'un fournisseur pour les virements (case de l'ERP « paiements sortants »). */
export async function confirmerCompte(C: number, bankId: number): Promise<void> {
  const [b]: any[] = await odooRpcCompany(C, 'res.partner.bank', 'read', [[bankId]], { fields: ['id', 'partner_id'] })
  if (!b) throw new Error('Compte bancaire introuvable')
  await odooRpcCompany(C, 'res.partner.bank', 'write', [[bankId], { allow_out_payment: true }])
}

/** Jour ouvrable belge : lundi → vendredi, hors jours fériés légaux. */
export function jourOuvrable(d = new Date()): boolean {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  const wd = local.getDay()
  if (wd === 0 || wd === 6) return false
  const period = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
  return !belgianHolidayDays(period).includes(local.getDate())
}

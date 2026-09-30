// Détail complet du lettrage d'une ligne de banque, facture par facture.
//
// Règle (Olivier 24/08 puis 29/09/2026) : sur chaque paiement, on doit voir le
// lettrage complet sans avoir à le déplier. Le lettrage peut être direct (ligne
// de banque ↔ factures) ou passer par un intermédiaire (paiement groupé, compte
// « Paiements entrants en suspens », OD de commission) : on suit la chaîne
// jusqu'aux factures et on rend la liste à plat, prête pour une note Odoo.
import { odooRpc, postChatterMessage } from '@/lib/odoo'

export interface LettrageRow {
  invoice: string          // n° de facture (ou de la pièce si ce n'en est pas une)
  partner: string | null
  amount: number           // montant de CE paiement imputé sur la facture
  invoiceTotal: number | null
  residual: number | null  // reste dû aujourd'hui
  via: string | null       // pièce intermédiaire (GROUP/…, PCHAU1/…, MISC/…)
  kind: 'invoice' | 'refund' | 'bill' | 'other'
  /** Ligne de la pièce lettrée (créance de la facture, ligne de l'OD…) et son solde signé. */
  lineId: number
  accountId: number
  partnerId: number | null
  balance: number          // débit − crédit de cette ligne
}

export interface LettrageDetail {
  bankMoveId: number
  bankMove: string
  date: string
  amount: number
  label: string
  rows: LettrageRow[]
  unmatched: number        // part de la ligne de banque encore non lettrée
}

const INVOICE_TYPES: Record<string, LettrageRow['kind']> = { out_invoice: 'invoice', out_refund: 'refund', in_invoice: 'bill', in_refund: 'bill' }
const round2 = (n: number) => Math.round(n * 100) / 100

type Line = { id: number; move_id: [number, string]; account_id: [number, string]; partner_id: [number, string] | false; debit: number; credit: number; amount_residual: number; matched_debit_ids: number[]; matched_credit_ids: number[]; name: string | false; display_type?: string }
const LINE_FIELDS = ['move_id', 'account_id', 'partner_id', 'debit', 'credit', 'amount_residual', 'matched_debit_ids', 'matched_credit_ids', 'name', 'display_type']

async function readLines(ids: number[]): Promise<Line[]> {
  return ids.length ? odooRpc<Line[]>('account.move.line', 'read', [ids], { fields: LINE_FIELDS }) : []
}

/** Lignes opposées lettrées avec `line`, et le montant lettré de chacune. */
async function partnersOf(line: Line): Promise<{ line: Line; amount: number }[]> {
  const pids = [...line.matched_debit_ids, ...line.matched_credit_ids]
  if (!pids.length) return []
  const parts = await odooRpc<any[]>('account.partial.reconcile', 'read', [pids], { fields: ['debit_move_id', 'credit_move_id', 'amount'] })
  const other = parts.map(p => ({ id: (p.debit_move_id[0] === line.id ? p.credit_move_id : p.debit_move_id)[0] as number, amount: Number(p.amount) }))
  const lines = await readLines([...new Set(other.map(o => o.id))])
  const byId = new Map(lines.map(l => [l.id, l]))
  return other.map(o => ({ line: byId.get(o.id)!, amount: o.amount })).filter(o => o.line)
}

export async function lettrageDetail(bankMoveId: number): Promise<LettrageDetail> {
  const [bm] = await odooRpc<any[]>('account.move', 'read', [[bankMoveId]], { fields: ['name', 'date', 'line_ids', 'journal_id'] })
  const [journal] = await odooRpc<any[]>('account.journal', 'read', [[bm.journal_id[0]]], { fields: ['default_account_id'] })
  const bankAccount = journal?.default_account_id?.[0]
  const lines = await readLines(bm.line_ids)
  const bankLine = lines.find(l => l.account_id[0] === bankAccount)
  const [st] = await odooRpc<any[]>('account.bank.statement.line', 'search_read', [[['move_id', '=', bankMoveId]]], { fields: ['payment_ref', 'amount'] })
  const counterparts = lines.filter(l => l.id !== bankLine?.id)

  const acc = new Map<string, LettrageRow>()
  const moveCache = new Map<number, any>()
  const moveOf = async (id: number) => {
    if (!moveCache.has(id)) {
      const [m] = await odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['name', 'move_type', 'partner_id', 'amount_total', 'amount_residual', 'line_ids', 'origin_payment_id'] })
      moveCache.set(id, m)
    }
    return moveCache.get(id)
  }
  const add = async (target: Line, amount: number, via: string | null) => {
    const m = await moveOf(target.move_id[0])
    const kind = INVOICE_TYPES[m.move_type] || 'other'
    const key = `${m.name}|${via || ''}|${target.id}`
    const prev = acc.get(key)
    if (prev) { prev.amount = round2(prev.amount + amount); return }
    acc.set(key, {
      lineId: target.id, accountId: target.account_id[0], partnerId: target.partner_id ? target.partner_id[0] : null,
      balance: round2(target.debit - target.credit),
      invoice: m.name, partner: (m.partner_id && m.partner_id[1]) || (target.partner_id && target.partner_id[1]) || null,
      amount: round2(amount), invoiceTotal: kind === 'other' ? null : m.amount_total,
      residual: kind === 'other' ? null : m.amount_residual, via, kind,
    })
  }

  // Parcours : contrepartie de la banque → lignes lettrées. Une facture est une
  // feuille. Toute autre pièce (paiement, OD) est un intermédiaire : on repart
  // de ses autres lignes lettrées (hors la ligne par laquelle on est arrivé).
  const seen = new Set<number>(lines.map(l => l.id))
  const walk = async (from: Line, amount: number, via: string | null, depth: number): Promise<void> => {
    const m = await moveOf(from.move_id[0])
    // Seul un PAIEMENT est un intermédiaire à traverser. Une OD, une autre
    // écriture de banque ou une facture est une pièce en soi : on s'y arrête
    // (sinon une reprise rouverte mène aux factures d'un autre virement).
    if (INVOICE_TYPES[m.move_type] || !m.origin_payment_id || depth > 3) { await add(from, amount, via); return }
    const siblings = (await readLines(m.line_ids)).filter(l => !seen.has(l.id) && (l.matched_debit_ids.length || l.matched_credit_ids.length))
    siblings.forEach(s => seen.add(s.id))
    if (!siblings.length) { await add(from, amount, via); return }
    const leaves: { line: Line; amount: number }[] = []
    for (const s of siblings) for (const p of await partnersOf(s)) if (!seen.has(p.line.id)) { seen.add(p.line.id); leaves.push(p) }
    if (!leaves.length) { await add(from, amount, via); return }
    for (const p of leaves) await walk(p.line, p.amount, via || m.name, depth + 1)
  }
  for (const c of counterparts) for (const p of await partnersOf(c)) { if (seen.has(p.line.id)) continue; seen.add(p.line.id); await walk(p.line, p.amount, null, 0) }

  const rows = [...acc.values()].sort((a, b) => (a.via || '').localeCompare(b.via || '') || a.invoice.localeCompare(b.invoice))
  // Reste ouvert sur la contrepartie (y compris un lettrage partiel).
  const unmatched = round2(counterparts.reduce((s, c) => s + Math.abs(c.amount_residual || 0), 0))
  return { bankMoveId, bankMove: bm.name, date: bm.date, amount: Number(st?.amount ?? 0), label: String(st?.payment_ref || ''), rows, unmatched }
}

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function lettrageHtml(d: LettrageDetail, intro?: string): string {
  const inv = d.rows.filter(r => r.kind === 'invoice' || r.kind === 'refund')
  const others = d.rows.filter(r => r.kind !== 'invoice' && r.kind !== 'refund')
  const sumInv = round2(inv.reduce((s, r) => s + (r.kind === 'refund' ? -r.amount : r.amount), 0))
  const sumAll = round2(d.rows.reduce((s, r) => s + (r.kind === 'refund' ? -r.amount : r.amount), 0))
  const td = 'padding:2px 10px 2px 0'
  const row = (r: LettrageRow) => `<tr><td style="${td}">${esc(r.invoice)}</td><td style="${td}">${esc(r.partner || '')}</td>`
    + `<td style="${td};text-align:right;white-space:nowrap"><b>${r.kind === 'refund' ? '−' : ''}${eur(r.amount)}</b></td>`
    + `<td style="${td};text-align:right;white-space:nowrap;color:#666">${r.invoiceTotal != null ? 'total ' + eur(r.invoiceTotal) : ''}</td>`
    + `<td style="${td};color:${r.residual && Math.abs(r.residual) > 0.005 ? '#b45309' : '#666'}">${r.residual == null ? '' : Math.abs(r.residual) > 0.005 ? 'reste dû ' + eur(r.residual) : 'soldée'}</td>`
    + `<td style="${td};color:#888">${r.via ? 'via ' + esc(r.via) : ''}</td></tr>`
  return (intro ? `<p>${esc(intro)}</p>` : '')
    + `<p><b>Détail du lettrage — ${esc(d.bankMove)}</b> du ${d.date.split('-').reverse().join('/')} · ${eur(d.amount)}</p>`
    + (inv.length ? `<p>${inv.length} facture${inv.length > 1 ? 's' : ''} pour ${eur(sumInv)} :</p><table style="border-collapse:collapse;font-size:13px">${inv.map(row).join('')}</table>` : '<p><i>Aucune facture lettrée.</i></p>')
    + (others.length ? `<p>Autres pièces :</p><table style="border-collapse:collapse;font-size:13px">${others.map(row).join('')}</table>` : '')
    + (Math.abs(sumAll - d.amount) > 0.005 && d.amount > 0 && sumAll > 0
        ? `<p>Écart avec le montant reçu : ${eur(round2(sumAll - d.amount))} (frais retenus à la source par la plateforme de paiement, ou part non lettrée ci-dessous).</p>` : '')
    + (d.unmatched > 0.005 ? `<p style="color:#b45309">Reste ouvert, non lettré : <b>${eur(d.unmatched)}</b></p>` : '')
}

/** Pose la note de détail sur l'extrait (là où la comptable la cherche). */
export async function documentLettrage(bankMoveId: number, intro?: string): Promise<LettrageDetail> {
  const d = await lettrageDetail(bankMoveId)
  await postChatterMessage('account.move', bankMoveId, lettrageHtml(d, intro))
  return d
}

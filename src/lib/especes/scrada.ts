// src/lib/especes/scrada.ts
//
// Encodage dans le livre de caisse Scrada d'un paiement en espèces confirmé par Momo
// (Olivier 06/10/2026) : une ligne « Paiement client », datée du jour de l'encodage,
// client + n° de facture (ce que l'ERP reconnaîtra dans le CODA du lendemain),
// remarque « Validation Momo du JJ/MM/AAAA », référence ERP et date d'origine.

const B = 'https://api.scrada.be/v1'
const H = () => ({ 'X-API-KEY': process.env.SCRADA_API_KEY || '', 'X-PASSWORD': process.env.SCRADA_API_PASSWORD || '', 'Content-Type': 'application/json', Accept: 'application/json' })
const fr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export function scradaConfigured(): boolean {
  return Boolean(process.env.SCRADA_API_KEY && process.env.SCRADA_API_PASSWORD && process.env.SCRADA_COMPANY_ID)
}

export async function encodeCashLine(it: { amount: number; client: string | null; invoice: string | null; payment_name: string; payment_date: string }, confirmedAt: string, typeId: string): Promise<string> {
  const C = process.env.SCRADA_COMPANY_ID
  const books: any[] = await (await fetch(`${B}/company/${C}/cashBook`, { headers: H(), cache: 'no-store' })).json()
  const book = (books || []).find(b => b.active)
  if (!book) throw new Error('Aucun livre de caisse actif dans Scrada')
  const start = Math.round(Number(book.currentBalance) * 100) / 100
  const amount = Math.round(Number(it.amount) * 100) / 100
  const body = {
    date: new Date().toISOString().slice(0, 10), startBalance: start, endBalance: Math.round((start + amount) * 100) / 100,
    lines: [{ lineType: 1, transactionTypeID: typeId, amount, companyName: it.client || '', invoiceNumber: it.invoice || '', remark: `Validation Momo du ${fr(confirmedAt)}`, externalReference: `${it.payment_name} du ${fr(it.payment_date)}` }],
  }
  const r = await fetch(`${B}/company/${C}/cashBook/${book.id}/lines`, { method: 'PUT', headers: H(), body: JSON.stringify(body), cache: 'no-store' })
  const t = await r.text()
  if (!r.ok) throw new Error(`Scrada ${r.status} : ${t.slice(0, 200)}`)
  let ids: any = null; try { ids = JSON.parse(t) } catch {}
  return Array.isArray(ids) ? String(ids[0] || '') : ''
}

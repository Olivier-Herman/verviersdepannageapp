// ============================================================
// Éclatement des versements déjà rapprochés
// ============================================================
//
// Les versements rapprochés avant le 24/08/2026 portent UNE contrepartie
// unique face à N rapprochements : l'extrait n'affiche qu'une ligne
// « Paiements entrants en suspens » et il faut déplier le lettrage un par un
// pour savoir ce qui est soldé.
//
// Ce script défait le lettrage, éclate la contrepartie en une ligne par
// paiement carte — chacune nommée avec sa facture — puis relettre.
// Aucune facture n'est touchée : c'est du lettrage pur.
//
//   npx tsx --env-file=.env.local scripts/payout-split-backfill.ts                    # simulation
//   npx tsx --env-file=.env.local scripts/payout-split-backfill.ts --only=1332537     # un seul
//   npx tsx --env-file=.env.local scripts/payout-split-backfill.ts --only=1332537 --apply
//   npx tsx --env-file=.env.local scripts/payout-split-backfill.ts --apply            # tout
//
// S'arrête à la première anomalie : mieux vaut un lot à moitié repris qu'un
// extrait laissé dans un état bâtard.

import { createAdminClient } from '../src/lib/supabase'
import { odooRpc }           from '../src/lib/odoo'
import { splitCounterpart }  from '../src/lib/reconcile-odoo'

const APPLY = process.argv.includes('--apply')
const ONLY  = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
const OUTSTANDING = 542
const SUSPENSE    = 265
const r2 = (n: number) => Math.round(n * 100) / 100
const eur = (n: number) => n.toFixed(2) + ' €'

async function main() {
  const sb = createAdminClient()
  let q = sb.from('payout_reconciliations')
    .select('id, provider, payout_ref, bank_line_id, net_amount, payload')
    .eq('status', 'done').not('bank_line_id', 'is', null).order('id')
  if (ONLY) q = q.eq('payout_ref', ONLY)
  const { data } = await q

  console.log(`\n  ${data?.length || 0} versement(s) à examiner${APPLY ? '' : '   (SIMULATION — rien n\'est écrit)'}\n`)
  let split = 0, deja = 0, skip = 0

  for (const row of (data || []) as any[]) {
    const tag = `${row.provider} ${row.payout_ref}`
    const txs = row.payload?.payout?.txs
    if (!txs?.length) { console.log(`  — ${tag} : trace sans détail`); skip++; continue }

    const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[row.bank_line_id]],
      { fields: ['move_id', 'is_reconciled', 'amount'] })
    if (!line?.move_id) { console.log(`  — ${tag} : ligne bancaire introuvable`); skip++; continue }
    const moveId = Array.isArray(line.move_id) ? line.move_id[0] : line.move_id

    const parts = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', moveId], ['account_id', 'in', [OUTSTANDING, SUSPENSE]],
    ]], { fields: ['id', 'credit', 'account_id', 'reconciled', 'matched_debit_ids'], limit: 100 })

    if (parts.length > 1) { console.log(`  ✓ ${tag} : déjà éclaté (${parts.length} lignes)`); deja++; continue }
    if (!parts.length)    { console.log(`  — ${tag} : aucune contrepartie`); skip++; continue }

    const only = parts[0]
    const sp = splitCounterpart(txs, Number(row.net_amount))
    const sum = r2(sp.reduce((s, x) => s + x.net, 0))
    if (Math.abs(sum - Number(row.net_amount)) > 0.005) {
      console.log(`  ✗ ${tag} : éclatement à ${eur(sum)} pour ${eur(Number(row.net_amount))} — ignoré`); skip++; continue
    }

    console.log(`  ▸ ${tag} · extrait ${moveId} · ${eur(Number(row.net_amount))} → ${sp.length} ligne(s)`)
    for (const x of sp) console.log(`        ${eur(x.net).padStart(10)}  ${x.label}`)
    if (!APPLY) { split++; continue }

    // Les paiements que ce lettrage consommait — à relier de nouveau après.
    const partialIds = only.matched_debit_ids || []
    const partials = partialIds.length
      ? await odooRpc<any[]>('account.partial.reconcile', 'read', [[...partialIds]], { fields: ['debit_move_id'] })
      : []
    const payLineIds = [...new Set(partials.map((p: any) =>
      Array.isArray(p.debit_move_id) ? Number(p.debit_move_id[0]) : Number(p.debit_move_id)))]

    // 1. Défaire, 2. éclater, 3. relier.
    await odooRpc('account.move.line', 'remove_move_reconcile', [[only.id]])
    await odooRpc('account.bank.statement.line', 'write', [[row.bank_line_id], {
      line_ids: [
        [1, only.id, { account_id: OUTSTANDING, name: sp[0].label, debit: 0, credit: sp[0].net, amount_currency: -sp[0].net }],
        ...sp.slice(1).map(x => [0, 0, { account_id: OUTSTANDING, name: x.label, debit: 0, credit: x.net, amount_currency: -x.net }]),
      ],
    }])
    const fresh = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', moveId], ['account_id', '=', OUTSTANDING],
    ]], { fields: ['id'], limit: 100 })
    await odooRpc('account.move.line', 'reconcile', [[...fresh.map(l => l.id), ...payLineIds]])

    const [after] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[row.bank_line_id]], { fields: ['is_reconciled'] })
    if (!after?.is_reconciled) throw new Error(`${tag} : l'extrait n'est plus lettré après reprise — ARRÊT`)
    console.log(`        ✓ ${fresh.length} lignes, extrait relettré`)
    split++
  }

  console.log(`\n  ${APPLY ? `${split} éclaté(s)` : `${split} à éclater`} · ${deja} déjà fait(s) · ${skip} ignoré(s)\n`)
}
main().catch(e => { console.error('\n  ARRÊT :', e?.message || e); process.exit(1) })

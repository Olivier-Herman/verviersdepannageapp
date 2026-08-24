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
const REDO  = process.argv.includes('--redo')   // reprend aussi les extraits déjà éclatés
const ONLY  = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
const OUTSTANDING = 542
const SUSPENSE    = 265
const r2 = (n: number) => Math.round(n * 100) / 100
const eur = (n: number) => n.toFixed(2) + ' €'

async function main() {
  const sb = createAdminClient()
  let q = sb.from('payout_reconciliations')
    .select('id, provider, payout_ref, bank_line_id, net_amount, payment_ids, payload')
    .eq('status', 'done').not('bank_line_id', 'is', null).order('id')
  if (ONLY) q = q.eq('payout_ref', ONLY)
  const { data } = await q

  console.log(`\n  ${data?.length || 0} versement(s) à examiner${APPLY ? '' : '   (SIMULATION — rien n\'est écrit)'}\n`)
  let split = 0, deja = 0, skip = 0

  for (const row of (data || []) as any[]) {
    const tag = `${row.provider} ${row.payout_ref}`
    const isAssureur = row.provider === 'ima' || row.provider === 'awp'
    const txs = row.payload?.payout?.txs
    if (!isAssureur && !txs?.length) { console.log(`  — ${tag} : trace sans détail`); skip++; continue }

    const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[row.bank_line_id]],
      { fields: ['move_id', 'is_reconciled', 'amount'] })
    if (!line?.move_id) { console.log(`  — ${tag} : ligne bancaire introuvable`); skip++; continue }
    const moveId = Array.isArray(line.move_id) ? line.move_id[0] : line.move_id

    const parts = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', moveId], ['account_id', 'in', [OUTSTANDING, SUSPENSE]],
    ]], { fields: ['id', 'credit', 'account_id', 'reconciled', 'matched_debit_ids'], limit: 100 })

    if (!parts.length) { console.log(`  — ${tag} : aucune contrepartie`); skip++; continue }
    if (parts.length > 1 && !REDO) { console.log(`  ✓ ${tag} : déjà éclaté (${parts.length} lignes)`); deja++; continue }

    const only = parts[0]

    // ── Assureurs : les parts viennent des PAIEMENTS créés, un par débiteur.
    if (isAssureur) {
      // La colonne `payment_ids` fait foi : le payload assureur ne porte pas
      // toujours le plan complet.
      const ids: number[] = (row.payment_ids?.length ? row.payment_ids : (row.payload?.plan?.paymentIds || [])) as number[]
      const payRows = ids.length
        ? await odooRpc<any[]>('account.payment', 'read', [ids], { fields: ['id', 'amount', 'partner_id'] })
        : []
      if (!payRows.length) { console.log(`  — ${tag} : aucun paiement tracé`); skip++; continue }

      const spA = payRows.map(pr => ({
        net: Math.round(Number(pr.amount) * 100) / 100,
        partnerId: Array.isArray(pr.partner_id) ? Number(pr.partner_id[0]) : null,
        paymentId: Number(pr.id),
        label: `${row.provider.toUpperCase()} ${row.payout_ref} — ${Array.isArray(pr.partner_id) ? pr.partner_id[1] : ''}`,
      }))
      const sumA = r2(spA.reduce((s, x) => s + x.net, 0))
      if (Math.abs(sumA - Number(row.net_amount)) > 0.02) {
        console.log(`  ✗ ${tag} : ${eur(sumA)} répartis pour ${eur(Number(row.net_amount))} — ignoré`); skip++; continue
      }
      console.log(`  ▸ ${tag} · extrait ${moveId} · ${eur(Number(row.net_amount))} → ${spA.length} ligne(s)`)
      for (const x of spA) console.log(`        ${eur(x.net).padStart(10)}  ${x.label}`)
      if (!APPLY) { split++; continue }

      const partialIdsA = parts.flatMap((l: any) => l.matched_debit_ids || [])
      const partialsA = partialIdsA.length
        ? await odooRpc<any[]>('account.partial.reconcile', 'read', [[...partialIdsA]], { fields: ['debit_move_id'] })
        : []
      const payLineIdsA = [...new Set(partialsA.map((x: any) =>
        Array.isArray(x.debit_move_id) ? Number(x.debit_move_id[0]) : Number(x.debit_move_id)))]

      await odooRpc('account.move.line', 'remove_move_reconcile', [parts.map((l: any) => l.id)])
      await odooRpc('account.move', 'button_draft', [[moveId]])
      try {
        await odooRpc('account.move', 'write', [[moveId], {
          line_ids: [
            [1, only.id, { account_id: OUTSTANDING, partner_id: spA[0].partnerId || false, name: spA[0].label,
                           debit: 0, credit: spA[0].net, amount_currency: -spA[0].net }],
            ...spA.slice(1).map(x => [0, 0, { account_id: OUTSTANDING, partner_id: x.partnerId || false, name: x.label,
                           debit: 0, credit: x.net, amount_currency: -x.net }]),
            ...parts.slice(1).map((l: any) => [2, l.id, false]),
          ],
        }])
      } finally {
        await odooRpc('account.move', 'action_post', [[moveId]])
      }

      const freshA = await odooRpc<any[]>('account.move.line', 'search_read', [[
        ['move_id', '=', moveId], ['account_id', '=', OUTSTANDING],
      ]], { fields: ['id'], order: 'id', limit: 100 })
      const byPayA = new Map<number, number>()
      if (payLineIdsA.length) {
        const rows = await odooRpc<any[]>('account.move.line', 'read', [payLineIdsA], { fields: ['id', 'payment_id'] })
        for (const l of rows) {
          const pid = Array.isArray(l.payment_id) ? Number(l.payment_id[0]) : Number(l.payment_id)
          if (pid && !byPayA.has(pid)) byPayA.set(pid, l.id)
        }
      }
      const usedA = new Set<number>()
      for (let i = 0; i < freshA.length && i < spA.length; i++) {
        const pl = byPayA.get(spA[i].paymentId)
        if (!pl) continue
        await odooRpc('account.move.line', 'reconcile', [[freshA[i].id, pl]])
        usedA.add(freshA[i].id); usedA.add(pl)
      }
      const restA = [...freshA.map(l => l.id), ...payLineIdsA].filter(id => !usedA.has(id))
      if (restA.length > 1) await odooRpc('account.move.line', 'reconcile', [restA])

      const [afterA] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[row.bank_line_id]], { fields: ['is_reconciled'] })
      if (!afterA?.is_reconciled) throw new Error(`${tag} : l'extrait n'est plus lettré après reprise — ARRÊT`)
      console.log(`        ✓ ${freshA.length} lignes, extrait relettré`)
      split++; continue
    }

    // Les anciens payloads ne portent pas le tiers de la facture : on le
    // récupère dans Odoo, sinon la ligne d'extrait n'affiche aucun client.
    const invIds = [...new Set(txs.flatMap((t: any) => t.invoiceIds || []))] as number[]
    const invs = invIds.length
      ? await odooRpc<any[]>('account.move', 'read', [invIds], { fields: ['id', 'partner_id'] })
      : []
    const partnerOfInvoice = new Map(invs.map(i => [i.id, Array.isArray(i.partner_id) ? Number(i.partner_id[0]) : null]))
    const enriched = txs.map((t: any) => ({
      ...t,
      partnerId:  t.partnerId ?? partnerOfInvoice.get((t.invoiceIds || [])[0]) ?? null,
      paymentIds: t.paymentIds?.length ? t.paymentIds : (t.paymentId ? [t.paymentId] : []),
    }))
    const sp = splitCounterpart(enriched, Number(row.net_amount))
    const sum = r2(sp.reduce((s, x) => s + x.net, 0))
    if (Math.abs(sum - Number(row.net_amount)) > 0.005) {
      console.log(`  ✗ ${tag} : éclatement à ${eur(sum)} pour ${eur(Number(row.net_amount))} — ignoré`); skip++; continue
    }

    console.log(`  ▸ ${tag} · extrait ${moveId} · ${eur(Number(row.net_amount))} → ${sp.length} ligne(s)`)
    for (const x of sp) console.log(`        ${eur(x.net).padStart(10)}  ${x.label}`)
    if (!APPLY) { split++; continue }

    // Les paiements que ce lettrage consommait — à relier de nouveau après.
    const partialIds = parts.flatMap((l: any) => l.matched_debit_ids || [])
    const partials = partialIds.length
      ? await odooRpc<any[]>('account.partial.reconcile', 'read', [[...partialIds]], { fields: ['debit_move_id'] })
      : []
    const payLineIds = [...new Set(partials.map((p: any) =>
      Array.isArray(p.debit_move_id) ? Number(p.debit_move_id[0]) : Number(p.debit_move_id)))]

    // 1. Défaire, 2. éclater, 3. relier.
    await odooRpc('account.move.line', 'remove_move_reconcile', [parts.map((l: any) => l.id)])
    // Brouillon → écriture unique sur la PIÈCE → revalidation. Les autres
    // chemins sont refusés par Odoo 19 (cf. commentaire dans paynovate-post).
    await odooRpc('account.move', 'button_draft', [[moveId]])
    try {
      await odooRpc('account.move', 'write', [[moveId], {
        line_ids: [
          // Chaque ligne porte SON client, pas le prestataire.
          [1, only.id, { account_id: OUTSTANDING, partner_id: sp[0].partnerId || false, name: sp[0].label,
                         debit: 0, credit: sp[0].net, amount_currency: -sp[0].net }],
          ...sp.slice(1).map(x => [0, 0, { account_id: OUTSTANDING, partner_id: x.partnerId || false, name: x.label,
                         debit: 0, credit: x.net, amount_currency: -x.net }]),
          // Les lignes surnuméraires d'une reprise précédente disparaissent.
          ...parts.slice(1).map((l: any) => [2, l.id, false]),
        ],
      }])
    } finally {
      await odooRpc('account.move', 'action_post', [[moveId]])
    }
    const fresh = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', moveId], ['account_id', '=', OUTSTANDING],
    ]], { fields: ['id'], order: 'id', limit: 100 })

    // Lettrage UN À UN : c'est ce qui fait apparaître, en face de chaque ligne,
    // le paiement qu'elle solde. En bloc, Odoo croise tout et n'affiche rien.
    const payLineByPayment = new Map<number, number>()
    if (payLineIds.length) {
      const payLines = await odooRpc<any[]>('account.move.line', 'read', [payLineIds], { fields: ['id', 'payment_id'] })
      for (const l of payLines) {
        const pid = Array.isArray(l.payment_id) ? Number(l.payment_id[0]) : Number(l.payment_id)
        if (pid && !payLineByPayment.has(pid)) payLineByPayment.set(pid, l.id)
      }
    }
    const used = new Set<number>()
    for (let i = 0; i < fresh.length && i < sp.length; i++) {
      const pl = sp[i].paymentId ? payLineByPayment.get(sp[i].paymentId!) : undefined
      if (!pl) continue
      await odooRpc('account.move.line', 'reconcile', [[fresh[i].id, pl]])
      used.add(fresh[i].id); used.add(pl)
    }
    const rest = [...fresh.map(l => l.id), ...payLineIds].filter(id => !used.has(id))
    if (rest.length > 1) await odooRpc('account.move.line', 'reconcile', [rest])

    const [after] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[row.bank_line_id]], { fields: ['is_reconciled'] })
    if (!after?.is_reconciled) throw new Error(`${tag} : l'extrait n'est plus lettré après reprise — ARRÊT`)
    console.log(`        ✓ ${fresh.length} lignes, extrait relettré`)
    split++
  }

  console.log(`\n  ${APPLY ? `${split} éclaté(s)` : `${split} à éclater`} · ${deja} déjà fait(s) · ${skip} ignoré(s)\n`)
}
main().catch(e => { console.error('\n  ARRÊT :', e?.message || e); process.exit(1) })

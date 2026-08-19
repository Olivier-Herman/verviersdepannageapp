// ============================================================
// Réconciliation SumUp — simulation
// ============================================================
//
// Rejoue le rapport de rapprochement et les écritures qui en découleraient,
// SANS RIEN ÉCRIRE dans Odoo. Sert à contrôler la chaîne avant d'ouvrir
// l'écran, et à rendre compte au comptable de ce que la validation produira.
//
//   npx tsx --env-file=.env.local scripts/sumup-reconcile-dryrun.ts
//   … --months=8      ← élargit la fenêtre de lecture chez SumUp
//
// Aucun mode --apply : la validation se fait à l'écran, un clic humain.

import { buildSumupMatchReport } from '../src/lib/sumup-match'
import { buildSumupPostingPlan } from '../src/lib/sumup-post'

const months = Number(process.argv.find(a => a.startsWith('--months='))?.split('=')[1]) || 5

const eur = (n: number) => n.toFixed(2).padStart(9) + ' €'

async function main() {
  const t0 = Date.now()
  const report = await buildSumupMatchReport(months)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`\n=== Réconciliation SumUp — simulation (${months} mois, ${secs} s) ===\n`)
  console.log(`${report.totals.count} versements · ${report.totals.amount.toFixed(2)} €`)
  for (const [k, v] of Object.entries(report.totals.byState)) {
    if (v.count) console.log(`   ${k.padEnd(6)} ${String(v.count).padStart(3)} · ${v.amount.toFixed(2)} €`)
  }

  for (const p of report.payouts) {
    console.log(`\n${'─'.repeat(78)}`)
    console.log(`[${p.state.toUpperCase()}] ${p.bankDate}  ${eur(p.bankAmount)}  ${p.terminal}  (extrait ${p.bankMoveName})`)
    console.log(`  brut ${p.grossAmount.toFixed(2)} € − commission ${p.commission.toFixed(2)} € = net ${p.bankAmount.toFixed(2)} €`)
    for (const t of p.txs) {
      const flag = t.issue ? `✗ ${t.issue}` : '✓'
      console.log(`  ${flag.padEnd(8)} ${eur(t.amount)}  « ${t.merchantRef || '—'} »`
        + `  → ${t.invoiceName || '?'}  ${t.partner || ''}  [${t.confidence}]`)
      if (t.issue) console.log(`             ${t.explanation}`)
    }
    if (p.blocking.length) for (const b of p.blocking) console.log(`  ⚠ ${b}`)

    if (p.state === 'ready' || p.state === 'lost') {
      const plan = buildSumupPostingPlan(p)
      console.log(`  → écritures :`)
      if (plan.paymentsToCreate.length) {
        for (const m of plan.paymentsToCreate) {
          console.log(`     paiement à créer  ${m.invoiceName}  ${m.amount.toFixed(2)} €  journal ${m.journal} (${m.site})`)
        }
      }
      if (plan.od) {
        for (const l of plan.od.lines) {
          console.log(`     OD j${plan.od.journal}  ${l.account}  D ${l.debit.toFixed(2)}  C ${l.credit.toFixed(2)}  · tiers ${plan.partnerId}`)
        }
      }
      console.log(`     extrait  265 → ${plan.bankCounterpart.account}  ${plan.net.toFixed(2)} €`)
      console.log(`     lettrage 542 : ${plan.paymentIds.length} paiement(s) existant(s)`
        + `${plan.paymentsToCreate.length ? ` + ${plan.paymentsToCreate.length} créé(s)` : ''}`)
      if (plan.warnings.length) for (const w of plan.warnings) console.log(`     ⚠ ${w}`)
    }
  }

  if (report.unmatched.length) {
    console.log(`\n=== Lignes bancaires non rattachables (${report.unmatched.length}) ===`)
    for (const u of report.unmatched) console.log(`  ${u.date}  ${eur(u.amount)}  ${u.reason}`)
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })

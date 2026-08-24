// ============================================================
// Détail des versements déjà rapprochés — reprise
// ============================================================
//
// Les versements rapprochés avant le 24/08/2026 ne portent pas leur détail
// dans Odoo : l'extrait n'affiche qu'une ligne « Paiements entrants en
// suspens » face à N rapprochements, et il faut déplier le lettrage un par un
// pour savoir ce qui a été soldé.
//
// Ce script rejoue la documentation à partir de la trace conservée dans
// `payout_reconciliations.payload` : libellé de la ligne 542 + note détaillée
// dans le fil de l'extrait. Il n'écrit AUCUNE écriture comptable.
//
//   npx tsx --env-file=.env.local scripts/payout-document-backfill.ts          # simulation
//   npx tsx --env-file=.env.local scripts/payout-document-backfill.ts --apply
//
// Idempotent : une trace déjà documentée est marquée et n'est pas reprise.

import { createAdminClient } from '../src/lib/supabase'
import { odooRpc, postChatterMessage } from '../src/lib/odoo'

const APPLY = process.argv.includes('--apply')
const MARK  = 'détail publié'

const eur   = (n: number) => Number(n || 0).toFixed(2).replace('.', ',') + ' €'
const jour  = (iso: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const heure = (iso: string | null) => (iso && String(iso).length > 12 ? ` ${String(iso).slice(11, 16)}` : '')

function bodyFor(row: any): { html: string; label: string; count: number } | null {
  const payout = row.payload?.payout
  const plan   = row.payload?.plan
  if (!payout?.txs?.length) return null

  const ref = plan?.od?.ref || payout.terminal || `versement ${row.payout_ref}`
  const rows = payout.txs.map((t: any) => {
    const note = t.unallocated ? `non affecté — ${t.unallocated.reason}`
               : t.rounding    ? `arrondi ${t.rounding > 0 ? '+' : ''}${Number(t.rounding).toFixed(2)} €`
               : t.partial     ? 'règlement partiel' : ''
    const carte = [t.cardBrand, t.by ? `par ${t.by}` : ''].filter(Boolean).join(' · ')
    return `<tr>
      <td style="padding:2px 8px 2px 0;white-space:nowrap">${jour(t.at)}${heure(t.at)}</td>
      <td style="padding:2px 8px 2px 0;text-align:right;white-space:nowrap"><b>${eur(t.amount)}</b></td>
      <td style="padding:2px 8px 2px 0">${t.invoiceName || '<i>sans facture</i>'}</td>
      <td style="padding:2px 8px 2px 0">${t.partner || ''}</td>
      <td style="padding:2px 8px 2px 0;color:#888">${[carte, t.merchantRef ? `réf. ${t.merchantRef}` : '', note].filter(Boolean).join(' · ')}</td>
    </tr>`
  }).join('')

  const html =
    `<p><b>Versement ${ref}</b> — ${payout.txs.length} paiement${payout.txs.length > 1 ? 's' : ''} carte`
    + ` pour ${eur(payout.grossAmount)} brut, ${eur(payout.bankAmount)} crédités.</p>`
    + `<table style="border-collapse:collapse;font-size:13px">${rows}</table>`
    + (Number(row.commission_amount) > 0.005
        ? `<p>Commission retenue à la source : <b>${eur(row.commission_amount)}</b> — passée en OD sur le compte fournisseur.</p>` : '')
    + `<p style="color:#888;font-size:12px">${MARK} — reprise du ${new Date().toISOString().slice(0, 10)}</p>`

  const names = [...new Set(payout.txs.map((t: any) => t.invoiceName).filter(Boolean))] as string[]
  const label = `Versement ${ref} — ${payout.txs.length} paiement${payout.txs.length > 1 ? 's' : ''} carte`
    + (names.length ? ` : ${names.slice(0, 6).join(', ')}${names.length > 6 ? `, +${names.length - 6}` : ''}` : '')

  return { html, label, count: payout.txs.length }
}

async function main() {
  const sb = createAdminClient()
  const { data } = await sb.from('payout_reconciliations')
    .select('id, provider, payout_ref, bank_line_id, commission_amount, payload, note, status')
    .eq('status', 'done')
    .order('id')

  const todo = (data || []).filter(r => r.bank_line_id && !String(r.note || '').includes(MARK))
  console.log(`\n  ${data?.length || 0} versements rapprochés · ${todo.length} à documenter${APPLY ? '' : '  (SIMULATION)'}\n`)

  let ok = 0, skip = 0
  for (const row of todo) {
    const built = bodyFor(row)
    if (!built) { console.log(`  — ${row.provider} ${row.payout_ref} : trace sans détail exploitable`); skip++; continue }

    const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[row.bank_line_id]], { fields: ['move_id', 'is_reconciled'] })
    if (!line?.move_id) { console.log(`  — ${row.provider} ${row.payout_ref} : ligne bancaire ${row.bank_line_id} introuvable`); skip++; continue }
    const moveId = Array.isArray(line.move_id) ? line.move_id[0] : line.move_id

    console.log(`  ${row.provider.padEnd(10)} ${String(row.payout_ref).padEnd(10)} extrait ${moveId} · ${built.count} paiement(s)`)
    if (!APPLY) continue

    await postChatterMessage('account.move', moveId, built.html)
    // Le libellé de la ligne 542, s'il porte encore le texte brut de la banque.
    const lines = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', moveId], ['account_id', '=', 542],
    ]], { fields: ['id'], limit: 2 })
    for (const l of lines) await odooRpc('account.move.line', 'write', [[l.id], { name: built.label }])

    await sb.from('payout_reconciliations')
      .update({ note: [row.note, MARK].filter(Boolean).join(' · ') })
      .eq('id', row.id)
    ok++
  }
  console.log(`\n  ${APPLY ? `${ok} documenté(s)` : 'simulation terminée'} · ${skip} ignoré(s)\n`)
}
main().catch(e => { console.error(e?.message || e); process.exit(1) })

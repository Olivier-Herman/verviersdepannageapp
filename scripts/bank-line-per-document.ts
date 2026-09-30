// Réécrit une ligne de banque déjà lettrée en UNE LIGNE PAR DOCUMENT, comme si
// on avait lié chaque facture soi-même dans le rapprochement bancaire (Olivier
// 29/09/2026). Les paiements intermédiaires (paiement groupé, compte d'attente)
// disparaissent : chaque ligne de l'extrait porte sa facture, son client et son
// montant, et est lettrée directement avec elle.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bank-line-per-document.ts BNK1/2026/02438 [--apply]
//
// À blanc par défaut. Refuse tout extrait dont le lettrage ne tombe pas juste
// au centime sur des factures (versements carte avec commission, reste ouvert…).
import { writeFileSync } from 'fs'
import { odooRpc } from '@/lib/odoo'
import { lettrageDetail, documentLettrage } from '@/lib/finance/lettrage-detail'

const round2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const name = process.argv[2]
  const apply = process.argv.includes('--apply')
  const [bm] = await odooRpc<any[]>('account.move', 'search_read', [[['name', '=', name]]], { fields: ['id', 'line_ids', 'journal_id', 'state'] })
  if (!bm) throw new Error(`${name} introuvable`)
  const d = await lettrageDetail(bm.id)
  if (d.unmatched > 0.005) throw new Error(`Reste ouvert ${d.unmatched} € — lettrage incomplet, à traiter à la main`)
  // Une ligne d'extrait par pièce : facture, note de crédit, facture fournisseur,
  // OD, autre écriture de banque. Chaque ligne reprend le compte et le tiers de
  // la ligne qu'elle lettre, au sens opposé.
  // Pièces accrochées au PAIEMENT intermédiaire autrement qu'à une facture
  // (commission carte, reprise, arrondi) : en annulant le paiement elles
  // resteraient orphelines. On les reprend sur l'extrait, chacune sa ligne.
  const viaList = [...new Set(d.rows.map(r => r.via).filter(Boolean))] as string[]
  if (viaList.length) {
    const vm = await odooRpc<any[]>('account.move', 'search_read', [[['name', 'in', viaList]]], { fields: ['id', 'name', 'line_ids'] })
    const vl = await odooRpc<any[]>('account.move.line', 'read', [vm.flatMap(m => m.line_ids)], { fields: ['move_id', 'matched_debit_ids', 'matched_credit_ids'] })
    const pids = vl.flatMap(l => [...l.matched_debit_ids, ...l.matched_credit_ids])
    const parts = pids.length ? await odooRpc<any[]>('account.partial.reconcile', 'read', [pids], { fields: ['debit_move_id', 'credit_move_id', 'amount'] }) : []
    const vlIds = new Set(vl.map(l => l.id))
    const otherIds = parts.map(p => vlIds.has(p.debit_move_id[0]) ? p.credit_move_id[0] : p.debit_move_id[0])
    const ol = otherIds.length ? await odooRpc<any[]>('account.move.line', 'read', [otherIds], { fields: ['move_id', 'move_type', 'account_id', 'partner_id', 'debit', 'credit'] }) : []
    for (const p of parts) {
      const oid = vlIds.has(p.debit_move_id[0]) ? p.credit_move_id[0] : p.debit_move_id[0]
      const o = ol.find(x => x.id === oid)
      if (!o || o.move_type !== 'entry' || o.move_id[0] === bm.id || vlIds.has(o.id)) continue
      if (d.rows.some(r => r.lineId === o.id)) continue
      d.rows.push({ invoice: o.move_id[1].split(' ')[0], partner: o.partner_id ? o.partner_id[1] : null, amount: round2(p.amount), invoiceTotal: null, residual: null,
        via: null, kind: 'other', lineId: o.id, accountId: o.account_id[0], partnerId: o.partner_id ? o.partner_id[0] : null, balance: round2(o.debit - o.credit) })
    }
  }
  const invIds = d.rows.filter(r => r.kind !== 'other').map(r => r.invoice)
  const invoices = invIds.length ? await odooRpc<any[]>('account.move', 'search_read', [[['name', 'in', invIds]]], { fields: ['id', 'name', 'partner_id', 'commercial_partner_id'] }) : []
  const sign = (r: typeof d.rows[number]) => (r.balance >= 0 ? -1 : 1)   // sens de la ligne d'extrait
  const plan = d.rows.map(r => {
    const inv = invoices.find(i => i.name === r.invoice)
    const partner = inv ? (inv.commercial_partner_id || inv.partner_id) : null
    const bal = round2(sign(r) * r.amount)      // débit − crédit de la ligne d'extrait
    return { name: r.invoice, amount: r.amount, bal, refund: bal > 0, recvLineId: r.lineId, accountId: r.accountId,
      partnerId: (partner ? partner[0] : r.partnerId) || false,
      label: `${r.invoice} — ${partner ? partner[1] : (r.partner || '')}`.replace(/ — $/, '') }
  })
  // Débit banque + Σ lignes = 0 ; quelques centimes d'écart admis (ligne d'arrondi).
  const sum = round2(-plan.reduce((s, p) => s + p.bal, 0))
  const ecart = round2(d.amount - sum)
  if (Math.abs(ecart) > 0.05) throw new Error(`Somme des pièces ${sum} ≠ montant ${d.amount}`)

  // Intermédiaires : paiements (groupés ou non) dont la pièce sert de relais.
  const viaNames = [...new Set(d.rows.map(r => r.via).filter(Boolean))] as string[]
  const viaMoves = viaNames.length ? await odooRpc<any[]>('account.move', 'search_read', [[['name', 'in', viaNames]]], { fields: ['id', 'name', 'origin_payment_id', 'move_type'] }) : []
  const payments = viaMoves.map(m => Array.isArray(m.origin_payment_id) ? m.origin_payment_id[0] : null).filter(Boolean) as number[]
  const nonPayment = viaMoves.filter(m => !m.origin_payment_id)
  if (nonPayment.length) throw new Error(`Intermédiaire qui n'est pas un paiement : ${nonPayment.map(m => m.name).join(', ')}`)

  const lines = await odooRpc<any[]>('account.move.line', 'read', [bm.line_ids], { fields: ['account_id', 'partner_id', 'name', 'debit', 'credit', 'matched_debit_ids', 'matched_credit_ids'] })
  const [journal] = await odooRpc<any[]>('account.journal', 'read', [[bm.journal_id[0]]], { fields: ['default_account_id'] })
  const counterparts = lines.filter(l => l.account_id[0] !== journal.default_account_id[0])

  console.log(`${name} · ${d.amount} € · ${plan.length} pièces · somme ${sum} €${ecart ? ` · écart d'arrondi ${ecart} €` : ''}`)
  console.log(`Contrepartie actuelle : ${counterparts.map(c => `${c.account_id[1]} ${c.credit - c.debit}`).join(' | ')}`)
  console.log(`Paiements intermédiaires à annuler : ${viaNames.join(', ') || 'aucun'}`)
  for (const p of plan) console.log(`  ${p.bal > 0 ? 'D' : 'C'} ${p.amount.toFixed(2).padStart(10)}  ${p.label}`)
  if (!apply) { console.log('\nÀ blanc — rien écrit. --apply pour appliquer.'); return }

  // Sauvegarde de l'état avant.
  const backup = { name, at: new Date().toISOString(), detail: d, lines, payments, viaNames }
  const file = `scripts/.backup-bank-per-doc-${name.replace(/\//g, '-')}-${Date.now()}.json`
  writeFileSync(file, JSON.stringify(backup, null, 2)); console.log(`Sauvegarde : ${file}`)

  // 1. L'avis (PDF) et la note des paiements passent sur l'extrait.
  if (payments.length) {
    const atts = await odooRpc<any[]>('ir.attachment', 'search_read', [[['res_model', '=', 'account.payment'], ['res_id', 'in', payments]]], { fields: ['id', 'name'] })
    const seenNames = new Set<string>()
    for (const a of atts) { if (seenNames.has(a.name)) continue; seenNames.add(a.name); await odooRpc('ir.attachment', 'copy', [[a.id], { res_model: 'account.move', res_id: bm.id }]) }
    // 2. Paiements intermédiaires : brouillon (délettre) puis annulés.
    await odooRpc('account.payment', 'action_draft', [payments])
    await odooRpc('account.payment', 'action_cancel', [payments])
  }

  // 3. L'extrait : brouillon, une ligne par facture, revalidé.
  const [first, ...others] = counterparts
  await odooRpc('account.move', 'button_draft', [[bm.id]])
  try {
    const cmd = (p: typeof plan[number]) => ({ account_id: p.accountId, partner_id: p.partnerId, name: p.label,
      debit: p.bal > 0 ? p.bal : 0, credit: p.bal < 0 ? -p.bal : 0, amount_currency: p.bal })
    await odooRpc('account.move', 'write', [[bm.id], { line_ids: [
      [1, first.id, cmd(plan[0])],
      ...others.map(o => [2, o.id]),
      ...plan.slice(1).map(p => [0, 0, cmd(p)]),
      // 757100 écart positif · 657100 écart négatif.
      ...(ecart ? [[0, 0, { account_id: ecart > 0 ? 461 : 409, partner_id: plan[0].partnerId, name: `Écart d'arrondi — ${name}`,
        debit: ecart < 0 ? -ecart : 0, credit: ecart > 0 ? ecart : 0, amount_currency: -ecart }]] : []),
    ] }])
  } finally {
    await odooRpc('account.move', 'action_post', [[bm.id]])
  }

  // 4. Lettrage un à un : chaque ligne avec SA facture.
  // Dans l'ordre d'écriture : la ligne réutilisée (plus ancien id) puis les créées.
  const newLines = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', '=', bm.id], ['account_id', '!=', journal.default_account_id[0]], ['account_id', 'not in', [461, 409]]]], { fields: ['id', 'name'], order: 'id' })
  if (newLines.length !== plan.length) throw new Error(`${newLines.length} lignes après réécriture pour ${plan.length} pièces`)
  for (let i = 0; i < plan.length; i++) {
    if (newLines[i].name !== plan[i].label) throw new Error(`Ordre inattendu : ${newLines[i].name} ≠ ${plan[i].label}`)
    // La ligne réutilisée peut être restée lettrée avec sa pièce : rien à refaire.
    const [a, b] = await odooRpc<any[]>('account.move.line', 'read', [[newLines[i].id, plan[i].recvLineId]], { fields: ['matching_number', 'reconciled'] })
    if (a.matching_number && a.matching_number === b.matching_number) continue
    await odooRpc('account.move.line', 'reconcile', [[newLines[i].id, plan[i].recvLineId]])
  }

  // 5. Contrôle.
  const after = await odooRpc<any[]>('account.move.line', 'read', [plan.map(p => p.recvLineId)], { fields: ['move_id', 'amount_residual', 'account_id'] })
  const open = after.filter(a => Math.abs(a.amount_residual) > 0.005 && a.account_id[0] !== 265).map(a => ({ name: a.move_id[1], amount_residual: a.amount_residual }))
  const bankAfter = await odooRpc<any[]>('account.move.line', 'read', [newLines.map(l => l.id)], { fields: ['amount_residual'] })
  const bankOpen = round2(bankAfter.reduce((s, l) => s + Math.abs(l.amount_residual), 0))
  console.log(`Factures encore dues : ${open.length ? open.map(o => `${o.name} ${o.amount_residual}`).join(', ') : 'aucune'} · extrait non lettré : ${bankOpen} €`)
  await documentLettrage(bm.id)
  console.log('Note de détail posée sur l’extrait.')
}
main().catch(e => { console.error('ÉCHEC :', e.message); process.exit(1) })

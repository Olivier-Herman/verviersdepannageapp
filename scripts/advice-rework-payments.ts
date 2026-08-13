// ============================================================
// Reprise des virements assureurs rapprochés à l'ancienne
// ============================================================
//
// Les premiers rapprochements assureurs basculaient la contrepartie de
// l'extrait directement vers 206 Clients, puis la lettraient contre les
// créances. Comptablement juste, mais illisible : l'extrait n'affiche qu'une
// ligne « Clients » face à N créances, et le détail n'existe que dans le
// lettrage. Olivier, 13/08/2026 : « je dois le voir dans le paiement ».
//
// Ce script défait ces rapprochements et les rejoue par le nouveau chemin, qui
// crée un vrai `account.payment` — Odoo affiche alors nativement la liste des
// factures payées, et chaque facture affiche le paiement en retour.
//
// Ne touche QUE ce que VD Soft a validé (trace dans payout_reconciliations).
// Les rapprochements faits à la main dans Odoo sont laissés tels quels.
//
//   npx tsx --env-file=.env.local scripts/advice-rework-payments.ts            # simulation
//   npx tsx --env-file=.env.local scripts/advice-rework-payments.ts --apply
//   … --bank=10366,10524    ← cible explicite (répétition sur base de test)

import { odooRpc }           from '../src/lib/odoo'
import { createAdminClient } from '../src/lib/supabase'
import { syncAdvices }       from '../src/lib/advice-cache'
import { buildAdviceReport } from '../src/lib/advice-match'
import { buildAdvicePlan, postAdvicePlan, RECEIVABLE, SUSPENSE, OUTSTANDING } from '../src/lib/advice-post'

const APPLY   = process.argv.includes('--apply')
const BANKARG = process.argv.find(a => a.startsWith('--bank='))
const MONTHS  = 3

const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'

/** Les virements rapprochés par VD Soft à l'ancienne — sans paiement associé. */
async function candidates(): Promise<{ bankLineId: number; label: string }[]> {
  if (BANKARG) {
    return BANKARG.split('=')[1].split(',').map(Number).filter(Boolean)
      .map(id => ({ bankLineId: id, label: `ligne ${id}` }))
  }
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('payout_reconciliations')
    .select('id,provider,payout_date,gross_amount,bank_line_id,payment_ids,status')
    .in('provider', ['ima', 'awp'])
    .eq('status', 'done')
    .order('id')
  if (error) throw new Error(error.message)

  return (data || [])
    .filter(r => !(r.payment_ids || []).length && r.bank_line_id)
    .map(r => ({
      bankLineId: Number(r.bank_line_id),
      label: `#${r.id} ${r.provider} ${r.payout_date} ${eur(Number(r.gross_amount))}`,
    }))
}

/**
 * Défait le rapprochement : délettrage, puis retour de la contrepartie en
 * compte d'attente. Le virement redevient exactement ce qu'il était avant.
 *
 * Deux formes possibles :
 *   206 Clients   → l'ancien chemin, lettré contre les créances.
 *   542 en suspens → une reprise déjà jouée ; on retire alors aussi les
 *                    paiements créés, sinon les factures resteraient soldées
 *                    par des paiements orphelins.
 */
async function undo(bankLineId: number): Promise<{ shape: string; undid: number; payments: number[] }> {
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[bankLineId]], { fields: ['move_id'] })
  const moveId = Array.isArray(line?.move_id) ? Number(line.move_id[0]) : Number(line?.move_id)
  if (!moveId) throw new Error(`Ligne bancaire ${bankLineId} sans écriture`)

  const counter = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', '=', moveId],
    ['account_id', 'in', [RECEIVABLE, OUTSTANDING]],
  ]], { fields: ['id', 'account_id', 'matched_debit_ids', 'matched_credit_ids'], limit: 2 })

  // Déjà en compte d'attente : rien à défaire, le virement n'attend que d'être
  // rejoué. Le cas se produit quand une reprise a échoué à mi-chemin.
  if (!counter.length) {
    const back = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', moveId], ['account_id', '=', SUSPENSE],
    ]], { fields: ['id'], limit: 1 })
    if (back.length) return { shape: 'déjà défait', undid: 0, payments: [] }
    throw new Error('Contrepartie introuvable — rapprochement fait autrement')
  }
  if (counter.length > 1) throw new Error('Plusieurs contreparties : à regarder à la main')

  const acc      = Array.isArray(counter[0].account_id) ? counter[0].account_id[0] : counter[0].account_id
  const isRework = Number(acc) === OUTSTANDING
  const partials = [...(counter[0].matched_debit_ids || []), ...(counter[0].matched_credit_ids || [])]

  // Les paiements en face, quand le virement a déjà été repris.
  let payments: number[] = []
  if (isRework && partials.length) {
    const ps = await odooRpc<any[]>('account.partial.reconcile', 'read', [partials], { fields: ['debit_move_id', 'credit_move_id'] })
    const otherIds = ps.map(p => {
      const d = Array.isArray(p.debit_move_id)  ? p.debit_move_id[0]  : p.debit_move_id
      const c = Array.isArray(p.credit_move_id) ? p.credit_move_id[0] : p.credit_move_id
      return d === counter[0].id ? c : d
    })
    const lines = await odooRpc<any[]>('account.move.line', 'read', [otherIds], { fields: ['move_id'] })
    const moves = [...new Set(lines.map(l => Array.isArray(l.move_id) ? l.move_id[0] : l.move_id))]
    const pays  = await odooRpc<any[]>('account.payment', 'search_read', [[['move_id', 'in', moves]]], { fields: ['id'] })
    payments = pays.map(p => p.id)
  }

  const shape = isRework ? 'reprise' : 'ancien'
  if (!APPLY) return { shape, undid: partials.length, payments }

  await odooRpc('account.move.line', 'remove_move_reconcile', [[counter[0].id]])
  await odooRpc('account.move.line', 'write', [[counter[0].id], { account_id: SUSPENSE, name: false }])

  if (payments.length) {
    await odooRpc('account.payment', 'action_draft', [payments])
    await odooRpc('account.payment', 'unlink',       [payments])
  }
  return { shape, undid: partials.length, payments }
}

async function main() {
  const targets = await candidates()
  console.log(`${targets.length} virement(s) à reprendre${APPLY ? '' : '  ·  SIMULATION'}\n`)
  if (!targets.length) return

  // Les avis doivent être en cache pour que le document parte dans Odoo.
  // `--force-cache` re-télécharge les pièces jointes déjà libérées — utile
  // après une répétition, qui a purgé le document en le posant dans Odoo.
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - MONTHS)
  const sync = await syncAdvices(since.toISOString(), { force: process.argv.includes('--force-cache') })
  console.log(`cache des avis : ${sync.read} lu(s), ${sync.cached} déjà connu(s), ${sync.failed} en échec\n`)

  // ── 1. Défaire ────────────────────────────────────────────
  const undone: number[] = []
  for (const t of targets) {
    try {
      const { shape, undid, payments } = await undo(t.bankLineId)
      console.log(`↩︎  ${t.label} · ${shape} · ${undid} lettrage(s) défait(s)`
        + (payments.length ? ` · ${payments.length} paiement(s) supprimé(s)` : ''))
      undone.push(t.bankLineId)
    } catch (e: any) {
      console.log(`✗  ${t.label} · ${e.message}`)
    }
  }
  if (!APPLY) { console.log('\n(simulation — rien n\'a été écrit)'); return }
  if (!undone.length) return

  // ── 2. Rejouer par le nouveau chemin ──────────────────────
  console.log('')
  const report = await buildAdviceReport(MONTHS)
  const sb = createAdminClient()

  for (const bankLineId of undone) {
    const item = report.items.find(i => i.bank?.lineId === bankLineId)
    if (!item)                  { console.log(`✗  ligne ${bankLineId} : absente du rapport — à reprendre à la main`); continue }
    if (item.state !== 'ready') { console.log(`✗  ligne ${bankLineId} : état « ${item.state} » — ${item.blocking[0] || ''}`); continue }

    try {
      const plan = buildAdvicePlan(item)
      const { reconciled, paymentIds } = await postAdvicePlan(plan)
      console.log(`✔  ligne ${bankLineId} · paiement(s) ${paymentIds.join(', ')}`
        + ` · ${reconciled} facture(s) lettrée(s) · ${eur(plan.amount)}`)

      await sb.from('payout_reconciliations')
        .update({ payment_ids: paymentIds })
        .eq('bank_line_id', bankLineId)
        .in('provider', ['ima', 'awp'])
    } catch (e: any) {
      console.log(`✗  ligne ${bankLineId} : ${e.message} — le virement est redevenu non lettré`)
    }
  }
}

main().catch(e => { console.error('✗', e?.message || e); process.exit(1) })

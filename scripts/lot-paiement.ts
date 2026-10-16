// scripts/lot-paiement.ts — prépare un paiement fournisseur et le range dans le lot de la semaine.
//
// Olivier 16/10/2026 : « je veux que tu puisses créer le paiement et l'inclure dans un lot pour que
// chaque semaine je puisse soumettre le lot à Momo ». Rien ne sort de la banque ici : le lot reste
// en brouillon dans l'ERP ; l'argent ne part que quand son fichier SEPA est chargé dans ING.
//
// Usage :
//   npx tsx --env-file=/home/mobig/dev/verviers-app/.env.local --tsconfig tsconfig.json scripts/lot-paiement.ts \
//     --societe 2 --factures "FACTU/2026/06/0011,FACTU/2026/10/0018" [--communication "+++470/4097/72581+++"] [--essai]
//   --societe 1 = Verviers Dépannage, 2 = Riga. --essai : montre ce qui serait fait, n'écrit rien.
//   Sans --factures : affiche le lot en cours de la semaine.
//
// Garde-fous : factures fournisseur validées et non payées, un seul fournisseur par paiement, IBAN du
// fournisseur autorisé aux paiements sortants, journal et méthode = ceux des derniers lots SEPA.
import { odooRpcCompany } from '@/lib/odoo'

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined }
const flag = (k: string) => process.argv.includes(`--${k}`)
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

;(async () => {
  const C = Number(arg('societe'))
  if (![1, 2].includes(C)) throw new Error('--societe 1 (VD) ou 2 (Riga) obligatoire')
  const essai = flag('essai')

  // Journal et méthode : ceux du dernier lot SEPA sortant de la société (aucune valeur en dur).
  const [last]: any[] = await odooRpcCompany(C, 'account.batch.payment', 'search_read', [[['batch_type', '=', 'outbound'], ['payment_method_id.code', '=', 'sepa_ct']]], { fields: ['journal_id'], order: 'id desc', limit: 1 })
  if (!last) throw new Error('Aucun lot SEPA précédent pour trouver le journal de paiement')
  const journal = last.journal_id[0]
  const [method]: any[] = await odooRpcCompany(C, 'account.payment.method.line', 'search_read', [[['journal_id', '=', journal], ['code', '=', 'sepa_ct'], ['payment_type', '=', 'outbound']]], { fields: ['id', 'name', 'payment_method_id'] })
  if (!method) throw new Error('Méthode « Virement SEPA » introuvable sur le journal')

  // Lot de la semaine = le lot SEPA sortant encore en brouillon sur ce journal ET dont le fichier XML
  // n'a pas encore été généré (nom de fichier vide ; la date de génération, elle, est remplie dès la
  // création du lot). Olivier 16/10/2026 : c'est lui qui crée le XML ; une fois créé, on
  // n'ajoute plus rien dans ce lot — le paiement suivant ouvre un nouveau lot.
  const openBatch = async () => (await odooRpcCompany<any[]>(C, 'account.batch.payment', 'search_read', [[['batch_type', '=', 'outbound'], ['journal_id', '=', journal], ['state', '=', 'draft'], ['export_filename', '=', false]]], { fields: ['id', 'name', 'amount', 'payment_ids', 'date'], order: 'id desc', limit: 1 }))[0]

  // Range les paiements dans le lot ouvert, ou crée le lot. (`create_batch_payment` refuse l'appel
  // par l'API sur l'ERP 19 : on écrit le lot directement.)
  const ranger = async (pays: any[]) => {
    const b = await openBatch()
    if (b) await odooRpcCompany(C, 'account.batch.payment', 'write', [[b.id], { payment_ids: pays.map(p => [4, p.id]) }])
    else await odooRpcCompany(C, 'account.batch.payment', 'create', [{ batch_type: 'outbound', journal_id: journal, payment_method_id: method.payment_method_id[0], payment_ids: [[6, 0, pays.map(p => p.id)]] }])
    const after = await openBatch()
    console.log(`Paiement ${pays.map(p => p.name).join(', ')} (${eur(pays.reduce((s, p) => s + p.amount, 0))}) ${b ? 'ajouté au lot' : 'dans le nouveau lot'} ${after?.name || '?'} · total du lot ${after ? eur(Math.abs(after.amount)) : '?'}`)
  }

  const names = (arg('factures') || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!names.length) {
    const b = await openBatch()
    if (!b) { console.log(`Aucun lot en cours (journal ${last.journal_id[1]}).`); return }
    const pays: any[] = await odooRpcCompany(C, 'account.payment', 'read', [b.payment_ids], { fields: ['name', 'partner_id', 'amount', 'memo'] })
    console.log(`Lot en cours ${b.name} (${b.date}) · ${pays.length} paiement(s) · ${eur(Math.abs(b.amount))}`)
    for (const p of pays) console.log(`  - ${p.partner_id?.[1]} · ${eur(p.amount)} · ${p.memo || ''}`)
    return
  }

  const bills: any[] = await odooRpcCompany(C, 'account.move', 'search_read', [[['name', 'in', names], ['company_id', '=', C]]], { fields: ['id', 'name', 'move_type', 'state', 'payment_state', 'amount_residual', 'partner_id', 'payment_reference'] })
  const missing = names.filter(n => !bills.some(b => b.name === n))
  if (missing.length) throw new Error(`Factures introuvables dans cette société : ${missing.join(', ')}`)
  // Reprise : paiement déjà créé pour ces factures mais resté hors lot → on le range, sans en recréer.
  const orphelins: any[] = await odooRpcCompany(C, 'account.payment', 'search_read', [[['reconciled_bill_ids', 'in', bills.map(b => b.id)], ['batch_payment_id', '=', false], ['journal_id', '=', journal], ['state', '!=', 'canceled'], ['payment_type', '=', 'outbound']]], { fields: ['id', 'name', 'amount'] })
  if (orphelins.length) { console.log(`Paiement déjà créé, hors lot : ${orphelins.map(p => p.name).join(', ')}`); if (!essai) await ranger(orphelins); return }
  const bad = bills.filter(b => b.move_type !== 'in_invoice' || b.state !== 'posted' || !['not_paid', 'partial'].includes(b.payment_state))
  if (bad.length) throw new Error(`Pas des factures fournisseur validées et à payer : ${bad.map(b => `${b.name} (${b.move_type}/${b.state}/${b.payment_state})`).join(', ')}`)
  const partners = [...new Set(bills.map(b => b.partner_id[0]))]
  if (partners.length !== 1) throw new Error('Un paiement = un seul fournisseur')
  const banks: any[] = await odooRpcCompany(C, 'res.partner.bank', 'search_read', [[['partner_id', '=', partners[0]], ['allow_out_payment', '=', true]]], { fields: ['id', 'acc_number'] })
  if (banks.length !== 1) throw new Error(`IBAN du fournisseur à confirmer : ${banks.length} compte(s) autorisé(s) aux paiements sortants`)
  const total = Math.round(bills.reduce((s, b) => s + b.amount_residual, 0) * 100) / 100
  const communication = arg('communication') || (bills.length === 1 ? bills[0].payment_reference || bills[0].name : bills.map(b => b.name).join(' '))

  console.log(`${essai ? '[ESSAI] ' : ''}${bills[0].partner_id[1]} · ${bills.map(b => `${b.name} ${eur(b.amount_residual)}`).join(' + ')} = ${eur(total)}`)
  console.log(`  vers ${banks[0].acc_number} · communication « ${communication} » · depuis ${last.journal_id[1]}`)
  if (essai) return

  const ctx = { active_model: 'account.move', active_ids: bills.map(b => b.id) }
  const today = new Date().toISOString().slice(0, 10)
  const wiz = await odooRpcCompany<number>(C, 'account.payment.register', 'create', [{ journal_id: journal, payment_method_line_id: method.id, payment_date: today, group_payment: true, communication, partner_bank_id: banks[0].id }], { context: ctx })
  await odooRpcCompany(C, 'account.payment.register', 'action_create_payments', [[wiz]], { context: ctx })
  const pays: any[] = await odooRpcCompany(C, 'account.payment', 'search_read', [[['reconciled_bill_ids', 'in', bills.map(b => b.id)], ['batch_payment_id', '=', false], ['journal_id', '=', journal], ['state', '!=', 'canceled']]], { fields: ['id', 'name', 'amount'] })
  if (!pays.length) throw new Error('Paiement créé introuvable : vérifier dans l’ERP avant de recommencer')

  await ranger(pays)
})().catch(e => { console.error('ERREUR :', e.message || e); process.exit(1) })


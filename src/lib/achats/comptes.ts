// src/lib/achats/comptes.ts — compte de charge par fournisseur dans l'ERP (Olivier 28/10/2026).
// C'est NOTRE vue de gestion : la comptable impute de son côté, on ne lui demande rien.
// Règles dans le réglage achats_comptes_fournisseurs (JSON) :
//   { "<partner_id>": "612903" }                                   → un compte pour toutes ses lignes
//   { "<partner_id>": [{ "si": "sandwich", "compte": "623401" }, …, { "compte": "603000" }] }
//                                                                    → selon le libellé de la ligne (regex, sans casse) ;
//                                                                      sans entrée par défaut, une ligne non reconnue reste où elle est ;
//                                                                      « tous »: true = reprend aussi une ligne encodée sur un compte qui
//                                                                      n'est pas une charge (ex. DGJ encodé sur une dette bancaire).
// 1. Brouillons : le bon compte est posé sur les lignes avant validation.
// 2. Factures déjà validées : écriture de reclassement du mois (journal des opérations diverses), calculée sur le
//    SOLDE par compte (factures + reclassements déjà passés) → jamais de double, rattrape un changement de règle.
// Lignes laissées telles quelles : compte qui n'est pas une charge (caisse, transit, acompte), ou ligne de
// rémunération (62x) quand la règle vise un autre compte (ex. une employée dont on a racheté le véhicule).

import { createAdminClient } from '@/lib/supabase'
import { odooRpc } from '@/lib/odoo'

type Regle = string | { si?: string; compte: string; tous?: boolean }[]
const REF = 'Reclassement des charges'

export async function lireRegles(): Promise<Record<string, Regle>> {
  const { data, error } = await createAdminClient().from('app_settings').select('value').eq('key', 'achats_comptes_fournisseurs').maybeSingle()
  if (error) throw new Error(`Réglage achats_comptes_fournisseurs illisible : ${error.message}`)
  const v = data?.value
  const o = typeof v === 'string' ? JSON.parse(v) : v
  if (!o || typeof o !== 'object') throw new Error('Réglage achats_comptes_fournisseurs vide.')
  return o
}

export function compteVoulu(regle: Regle | undefined, libelle: string): { compte: string; tous?: boolean } | null {
  if (!regle) return null
  if (typeof regle === 'string') return { compte: regle }
  for (const r of regle) if (!r.si || new RegExp(r.si, 'i').test(libelle)) return r
  return null
}

/** Compte final d'une ligne de facture d'achat (null = on n'y touche pas). */
function cible(regle: Regle | undefined, l: any, src: { code: string; account_type: string }): string | null {
  const r = compteVoulu(regle, String(l.name || '')); const c = r?.compte
  if (!c || c === src.code) return null
  if (src.account_type !== 'expense' && !r?.tous) return null
  if (src.code.startsWith('62') && !c.startsWith('62')) return null
  return c
}

async function comptes() {
  const acc: any[] = await odooRpc('account.account', 'search_read', [[]], { fields: ['id', 'code', 'name', 'account_type'] })
  return { byId: new Map(acc.map(a => [a.id, a])), byCode: new Map(acc.map(a => [a.code, a])) }
}

/** 1. Brouillons d'achat : bon compte posé ligne par ligne. */
export async function corrigerBrouillons(): Promise<{ lignes: number; factures: string[] }> {
  const regles = await lireRegles(); const { byId, byCode } = await comptes()
  const ids = Object.keys(regles).map(Number).filter(Number.isInteger)
  const ls: any[] = await odooRpc('account.move.line', 'search_read', [[['partner_id', 'in', ids], ['parent_state', '=', 'draft'], ['display_type', '=', 'product'], ['move_id.move_type', 'in', ['in_invoice', 'in_refund']]]], { fields: ['id', 'name', 'account_id', 'partner_id', 'move_id', 'move_name'] })
  const parFacture = new Map<number, any[]>(); const noms = new Set<string>()
  for (const l of ls) {
    const src = byId.get(l.account_id?.[0]); if (!src) continue
    const c = cible(regles[String(l.partner_id[0])], l, src); const to = c ? byCode.get(c) : null
    if (!to) continue
    parFacture.set(l.move_id[0], [...(parFacture.get(l.move_id[0]) || []), [1, l.id, { account_id: to.id }]]); noms.add(l.move_name || `#${l.move_id[0]}`)
  }
  for (const [id, cmds] of parFacture) await odooRpc('account.move', 'write', [[id], { line_ids: cmds }])
  return { lignes: [...parFacture.values()].reduce((s, x) => s + x.length, 0), factures: [...noms] }
}

const finMois = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) }
const r2 = (n: number) => Math.round(n * 100) / 100

/** 2. Factures validées du mois « AAAA-MM » : une écriture pour l'écart entre le solde voulu et le solde réel. */
export async function reclasserMois(m: string, opts: { simuler?: boolean } = {}): Promise<{ mois: string; ecriture?: string; lignes: number; montant: number; detail: string[] }> {
  const regles = await lireRegles(); const { byId } = await comptes()
  const ids = Object.keys(regles).map(Number).filter(Number.isInteger)
  const du = `${m}-01`, au = finMois(m)
  const factures: any[] = await odooRpc('account.move.line', 'search_read', [[['partner_id', 'in', ids], ['parent_state', '=', 'posted'], ['date', '>=', du], ['date', '<=', au], ['display_type', '=', 'product'], ['move_id.move_type', 'in', ['in_invoice', 'in_refund']]]], { fields: ['name', 'balance', 'account_id', 'partner_id'] })
  const reclasses: any[] = await odooRpc('account.move.line', 'search_read', [[['partner_id', 'in', ids], ['parent_state', '=', 'posted'], ['date', '>=', du], ['date', '<=', au], ['move_id.move_type', '=', 'entry'], ['move_id.ref', '=like', `${REF} %`]]], { fields: ['balance', 'account_id', 'partner_id'] })
  // écart[partenaire][compte] = voulu − réel
  const ecart = new Map<number, Map<number, number>>()
  const add = (p: number, a: number, v: number) => { const x = ecart.get(p) || new Map(); x.set(a, (x.get(a) || 0) + v); ecart.set(p, x) }
  const codeVersId = new Map([...byId.values()].map((a: any) => [a.code, a.id]))
  for (const l of factures) {
    const src = byId.get(l.account_id?.[0]); if (!src) continue
    const c = cible(regles[String(l.partner_id[0])], l, src)
    const voulu = c ? codeVersId.get(c) : src.id
    if (!voulu) continue
    add(l.partner_id[0], voulu, l.balance); add(l.partner_id[0], src.id, -l.balance)
  }
  for (const l of reclasses) add(l.partner_id[0], l.account_id[0], -l.balance)
  const lignes: any[] = []; const detail: string[] = []; let montant = 0
  for (const [p, parCompte] of ecart) {
    const moins = [...parCompte].filter(([, v]) => r2(v) < 0), plus = [...parCompte].filter(([, v]) => r2(v) > 0)
    if (!plus.length) continue
    const nom = factures.find(l => l.partner_id[0] === p)?.partner_id[1] || reclasses.find(l => l.partner_id[0] === p)?.partner_id[1] || `#${p}`
    const libelle = `Reclassement ${nom} : ${moins.map(([a]) => byId.get(a)?.code).join('+')} → ${plus.map(([a]) => byId.get(a)?.code).join('+')}`
    for (const [a, v] of parCompte) {
      const x = r2(v); if (!x) continue
      lignes.push([0, 0, { account_id: a, partner_id: p, name: libelle, debit: x > 0 ? x : 0, credit: x < 0 ? -x : 0 }])
      if (x > 0) montant += x
    }
    detail.push(`${libelle} : ${r2(plus.reduce((s, [, v]) => s + v, 0)).toFixed(2)} €`)
  }
  if (!lignes.length || opts.simuler) return { mois: m, lignes: lignes.length, montant: r2(montant), detail }
  const id = await odooRpc<number>('account.move', 'create', [{ move_type: 'entry', journal_id: await journalOD(), date: au, ref: `${REF} ${m} (automatique du ${new Date().toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })})`, line_ids: lignes }])
  await odooRpc('account.move', 'action_post', [[id]])
  const [mv]: any[] = await odooRpc('account.move', 'read', [[id]], { fields: ['name'] })
  return { mois: m, ecriture: mv?.name, lignes: lignes.length, montant: r2(montant), detail }
}

async function journalOD(): Promise<number> {
  const j: any[] = await odooRpc('account.journal', 'search_read', [[['type', '=', 'general'], ['code', '=', 'MISC']]], { fields: ['id'], limit: 1 })
  if (!j[0]) throw new Error('Journal des opérations diverses introuvable.')
  return j[0].id
}

/** Passage quotidien : brouillons, puis le mois en cours et le précédent (factures validées en retard). */
export async function passageComptesAchats() {
  const brouillons = await corrigerBrouillons()
  const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 7)
  const [y, mo] = auj.split('-').map(Number); const prec = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
  const mois = [await reclasserMois(prec), await reclasserMois(auj)]
  return { brouillons, mois }
}

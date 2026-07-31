// ============================================================
// VERVIERS DÉPANNAGE — Connecteur Odoo DÉDIÉ au module Achats
// ------------------------------------------------------------
// ISOLATION MULTI-SOCIÉTÉ : le module Achats peut lire plusieurs sociétés
// (Verviers Dépannage + Dépannage Riga + DGJ VHU) SANS élargir l'utilisateur
// « VD App » du reste de l'app (qui doit rester cloisonné à Verviers Dépannage).
//
// → Créer dans Odoo un utilisateur dédié « VD Achats » avec les sociétés
//   voulues en « sociétés autorisées », puis renseigner en env :
//     ODOO_ACHATS_UID           (uid du user dédié)
//     ODOO_ACHATS_API_KEY       (sa clé API)
//     ODOO_ACHATS_COMPANY_IDS   (ex: "1,2,3" — sociétés à consolider)
//
// Tant que ces variables ne sont pas posées → repli sur VD App (Verviers
// Dépannage uniquement). Aucun autre module n'utilise ce connecteur.
// ============================================================

import { fetchWithRetry } from '@/lib/fetch-with-retry'

const ODOO_URL = process.env.ODOO_URL!
const ODOO_DB  = process.env.ODOO_DB!
const UID = parseInt(process.env.ODOO_ACHATS_UID || process.env.ODOO_UID || '8')
const KEY = process.env.ODOO_ACHATS_API_KEY || process.env.ODOO_API_KEY!

/** Sociétés à consolider (vide → contexte société par défaut de l'utilisateur). */
export const ACHATS_COMPANY_IDS: number[] = (process.env.ODOO_ACHATS_COMPANY_IDS || '')
  .split(',').map(s => parseInt(s.trim())).filter(Boolean)

export async function achatsRpc<T = any>(model: string, method: string, args: any[] = [], kwargs: Record<string, any> = {}): Promise<T> {
  // Injecte allowed_company_ids dans le contexte SANS écraser un contexte
  // fourni par l'appelant (ex: lang pour les libellés de comptes).
  const context = {
    ...(ACHATS_COMPANY_IDS.length ? { allowed_company_ids: ACHATS_COMPANY_IDS } : {}),
    ...(kwargs.context || {}),
  }
  const finalKwargs = { ...kwargs, ...(Object.keys(context).length ? { context } : {}) }

  const res = await fetchWithRetry(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: { service: 'object', method: 'execute_kw', args: [ODOO_DB, UID, KEY, model, method, args, finalKwargs] },
    }),
    timeoutMs: 25000, maxAttempts: 3, logPrefix: `[Odoo Achats ${model}.${method}]`,
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo RPC [${model}.${method}]: ${JSON.stringify(data.error?.data?.message || data.error)}`)
  return data.result
}

// Partenaires = les sociétés du groupe elles-mêmes (VD, Riga, DGJ). Sert à
// NEUTRALISER l'intercompagnie : une facture d'une société du groupe à une
// autre n'est pas un achat externe → exclue des analyses de coût. Cache 10 min.
let _coCache: { ids: number[]; exp: number } | null = null
export async function getGroupCompanyPartnerIds(): Promise<number[]> {
  if (_coCache && _coCache.exp > Date.now()) return _coCache.ids
  const comps = await achatsRpc<any[]>('res.company', 'search_read', [[]], { fields: ['partner_id'] })
  const ids = comps.map(c => (Array.isArray(c.partner_id) ? c.partner_id[0] : null)).filter(Boolean) as number[]
  _coCache = { ids, exp: Date.now() + 600_000 }
  return ids
}
